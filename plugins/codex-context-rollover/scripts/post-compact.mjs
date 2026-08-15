import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 60_000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function writeHookResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function getDataRoot() {
  const configured =
    process.env.CODEX_CONTEXT_ROLLOVER_DATA ??
    process.env.PLUGIN_DATA ??
    process.env.CLAUDE_PLUGIN_DATA ??
    "";
  if (configured.trim() === "") {
    throw new Error("PLUGIN_DATA was not provided by the Codex plugin runtime.");
  }
  return path.resolve(configured);
}

function getReminderThreshold() {
  const configured = Number.parseInt(
    process.env.CODEX_CONTEXT_ROLLOVER_THRESHOLD ?? "2",
    10,
  );
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 2;
}

function usesEnglish() {
  return (process.env.CODEX_CONTEXT_ROLLOVER_LOCALE ?? "zh-TW")
    .toLowerCase()
    .startsWith("en");
}

function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmdirSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") {
          continue;
        }
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out while locking the compaction state.");
      }
      Atomics.wait(sleepBuffer, 0, 0, 100);
    }
  }
}

function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

function captureTranscriptCheckpoint(transcriptPath) {
  const descriptor = openSync(transcriptPath, "r");
  try {
    const byteLength = fstatSync(descriptor).size;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < byteLength) {
      const requested = Math.min(buffer.length, byteLength - offset);
      const bytesRead = readSync(descriptor, buffer, 0, requested, offset);
      if (bytesRead <= 0) {
        throw new Error("Transcript ended before its captured byte boundary.");
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return {
      transcriptPath,
      byteLength,
      sha256: hash.digest("hex"),
    };
  } finally {
    closeSync(descriptor);
  }
}

function reminderMessage(compactionCount, checkpoint) {
  const shortHash = checkpoint.sha256.slice(0, 12);
  if (usesEnglish()) {
    return `This task has completed compaction #${compactionCount}. A checkpoint was recorded (SHA-256 ${shortHash}, ${checkpoint.byteLength} bytes). To avoid context distortion and task drift, use /new now. The old task remains available, but a new task does not automatically inherit its objective.`;
  }
  return `此任務已完成第 ${compactionCount} 次內容壓縮。檢查點已記錄（SHA-256 ${shortHash}，${checkpoint.byteLength} bytes）。為避免壓縮失真與任務飄移，請現在使用 /new 開啟乾淨任務。舊任務仍會保留，但新任務不會自動承接舊任務目標。`;
}

function checkpointFailureMessage(compactionCount, checkpointError) {
  if (usesEnglish()) {
    return `Compaction #${compactionCount} completed, but its checkpoint could not be recorded: ${checkpointError}. This plugin does not block the task; keep this task open and inspect /hooks plus the plugin data directory.`;
  }
  return `第 ${compactionCount} 次內容壓縮已完成，但檢查點記錄失敗：${checkpointError}。此外掛不會攔截任務；請保留此任務，並檢查 /hooks 與外掛資料目錄。`;
}

function hookFailureMessage(error) {
  if (usesEnglish()) {
    return `Codex Context Rollover failed: ${errorMessage(error)}`;
  }
  return `Codex Context Rollover 執行失敗：${errorMessage(error)}`;
}

try {
  const rawInput = readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  const event = JSON.parse(rawInput);
  if (event.hook_event_name !== "PostCompact") {
    writeHookResult({ continue: true });
    process.exit(0);
  }

  const sessionId = String(event.session_id ?? "").trim();
  if (sessionId === "") {
    throw new Error("PostCompact did not include a session_id.");
  }

  const dataRoot = getDataRoot();
  const sessionKey = createHash("sha256").update(sessionId, "utf8").digest("hex");
  const sessionDirectory = path.join(dataRoot, "sessions", sessionKey);
  mkdirSync(sessionDirectory, { recursive: true });
  const statePath = path.join(sessionDirectory, "state.json");
  const lockPath = path.join(sessionDirectory, "state.lock");

  acquireLock(lockPath);
  let compactionCount;
  let checkpoint;
  let checkpointError = null;
  try {
    let previousState = {};
    if (existsSync(statePath)) {
      previousState = JSON.parse(readFileSync(statePath, "utf8"));
    }
    const previousCount = Number.isInteger(previousState.compactionCount)
      ? previousState.compactionCount
      : 0;
    compactionCount = previousCount + 1;
    const recordedAtUtc = new Date().toISOString();

    try {
      const providedTranscriptPath = String(event.transcript_path ?? "").trim();
      if (providedTranscriptPath === "") {
        throw new Error("PostCompact did not include a transcript_path.");
      }
      const eventCwd = path.resolve(String(event.cwd ?? process.cwd()));
      const transcriptPath = path.resolve(eventCwd, providedTranscriptPath);
      checkpoint = captureTranscriptCheckpoint(transcriptPath);
      const checkpointRecord = {
        schemaVersion: 1,
        sessionKey,
        compactionCount,
        recordedAtUtc,
        trigger: String(event.trigger ?? ""),
        turnId: event.turn_id == null ? null : String(event.turn_id),
        cwd: eventCwd,
        ...checkpoint,
      };
      const timestamp = recordedAtUtc.replace(/[-:.]/g, "");
      const checkpointName = `${String(compactionCount).padStart(4, "0")}-${timestamp}-${randomBytes(4).toString("hex")}.json`;
      writeJsonAtomically(path.join(sessionDirectory, checkpointName), checkpointRecord);
    } catch (error) {
      checkpointError = errorMessage(error);
    }

    writeJsonAtomically(statePath, {
      schemaVersion: 1,
      sessionKey,
      compactionCount,
      updatedAtUtc: recordedAtUtc,
      lastCheckpoint: checkpoint ?? previousState.lastCheckpoint ?? null,
      checkpointError,
    });
  } finally {
    rmdirSync(lockPath);
  }

  if (checkpointError !== null) {
    writeHookResult({
      continue: true,
      systemMessage: checkpointFailureMessage(compactionCount, checkpointError),
    });
  } else if (compactionCount >= getReminderThreshold()) {
    writeHookResult({
      continue: true,
      systemMessage: reminderMessage(compactionCount, checkpoint),
    });
  } else {
    writeHookResult({ continue: true });
  }
} catch (error) {
  writeHookResult({
    continue: true,
    systemMessage: hookFailureMessage(error),
  });
}
