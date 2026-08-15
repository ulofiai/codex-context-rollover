import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = process.env.CODEX_CONTEXT_ROLLOVER_HOOK_PATH
  ? path.resolve(process.env.CODEX_CONTEXT_ROLLOVER_HOOK_PATH)
  : path.join(
      repositoryRoot,
      "plugins",
      "codex-context-rollover",
      "scripts",
      "context-rollover.mjs",
    );

function runHook(dataRoot, event, extraEnv = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: dataRoot,
      CODEX_CONTEXT_ROLLOVER_LOCALE: "en",
      ...extraEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function sessionDirectory(dataRoot, sessionId) {
  const key = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return path.join(dataRoot, "sessions", key);
}

function pendingFiles(dataRoot) {
  const directory = path.join(dataRoot, "pending");
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));
}

function postCompactEvent(root, transcriptPath, sessionId, turnId = "turn-1") {
  return {
    hook_event_name: "PostCompact",
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: root,
    trigger: "auto",
    turn_id: turnId,
  };
}

function clearEvent(root, sessionId = "cleared-session") {
  return {
    hook_event_name: "SessionStart",
    source: "clear",
    session_id: sessionId,
    transcript_path: null,
    cwd: root,
  };
}

function transcriptWithUserAnchors() {
  return [
    {
      type: "event_msg",
      payload: { type: "user_message", message: "Build objective A exactly; do not turn it into B." },
    },
    {
      type: "event_msg",
      payload: { type: "agent_message", message: "Working on A." },
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "Latest constraint: never add a blocking guardrail." },
    },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n") + "\n";
}

test("arms a lossless one-time handoff at the second compaction", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  const transcript = transcriptWithUserAnchors();
  writeFileSync(transcriptPath, transcript, "utf8");

  const first = runHook(
    dataRoot,
    postCompactEvent(root, transcriptPath, "session-a", "turn-1"),
  );
  assert.deepEqual(first, { continue: true });

  const second = runHook(
    dataRoot,
    postCompactEvent(root, transcriptPath, "session-a", "turn-2"),
  );
  assert.equal(second.continue, true);
  assert.match(second.systemMessage, /Compaction #2/);
  assert.match(second.systemMessage, /lossless local rollover snapshot/);
  assert.match(second.systemMessage, /\/clear/);
  assert.match(second.systemMessage, /\/new stays unrelated/);

  const directory = sessionDirectory(dataRoot, "session-a");
  const state = JSON.parse(readFileSync(path.join(directory, "state.json"), "utf8"));
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.compactionCount, 2);
  assert.equal(state.checkpointError, null);
  assert.equal(state.handoffArmed, true);
  assert.equal(state.lastCheckpoint.byteLength, Buffer.byteLength(transcript));
  assert.equal(
    state.lastCheckpoint.sha256,
    createHash("sha256").update(transcript).digest("hex"),
  );
  assert.equal(readFileSync(state.lastCheckpoint.snapshotPath, "utf8"), transcript);

  const entries = readdirSync(directory);
  assert.equal(entries.filter((name) => /^\d{4}-.*\.json$/.test(name)).length, 2);
  assert.equal(entries.filter((name) => name.endsWith(".transcript.jsonl")).length, 1);
  assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
  assert.equal(entries.includes("state.lock"), false);
  assert.equal(pendingFiles(dataRoot).length, 1);
});

test("/clear consumes the handoff once and injects exact user anchors", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, transcriptWithUserAnchors(), "utf8");

  runHook(dataRoot, postCompactEvent(root, transcriptPath, "source-session", "turn-1"));
  runHook(dataRoot, postCompactEvent(root, transcriptPath, "source-session", "turn-2"));

  const startup = runHook(dataRoot, {
    hook_event_name: "SessionStart",
    source: "startup",
    session_id: "unrelated-new-task",
    cwd: root,
  });
  assert.deepEqual(startup, { continue: true });
  assert.equal(pendingFiles(dataRoot).length, 1);

  const cleared = runHook(dataRoot, clearEvent(root));
  assert.equal(cleared.continue, true);
  assert.match(cleared.systemMessage, /One-time rollover handoff loaded/);
  assert.equal(cleared.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(cleared.hookSpecificOutput.additionalContext, /Build objective A exactly/);
  assert.match(cleared.hookSpecificOutput.additionalContext, /never add a blocking guardrail/);
  assert.match(cleared.hookSpecificOutput.additionalContext, /user-message priority/);
  assert.match(cleared.hookSpecificOutput.additionalContext, /Transcript snapshot:/);
  assert.equal(pendingFiles(dataRoot).length, 0);

  assert.deepEqual(runHook(dataRoot, clearEvent(root, "second-clear")), {
    continue: true,
  });
});

test("expired handoffs are consumed without injecting an old objective", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, transcriptWithUserAnchors(), "utf8");

  runHook(dataRoot, postCompactEvent(root, transcriptPath, "session-expired", "turn-1"));
  runHook(dataRoot, postCompactEvent(root, transcriptPath, "session-expired", "turn-2"));
  const [pendingPath] = pendingFiles(dataRoot);
  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  pending.expiresAtUtc = "2000-01-01T00:00:00.000Z";
  writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, "utf8");

  const cleared = runHook(dataRoot, clearEvent(root));
  assert.equal(cleared.continue, true);
  assert.match(cleared.systemMessage, /expired/);
  assert.equal("hookSpecificOutput" in cleared, false);
  assert.equal(pendingFiles(dataRoot).length, 0);
});

test("keeps only the configured number of lossless snapshots", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, transcriptWithUserAnchors(), "utf8");

  for (let count = 1; count <= 4; count += 1) {
    runHook(
      dataRoot,
      postCompactEvent(root, transcriptPath, "retention-session", `turn-${count}`),
      { CODEX_CONTEXT_ROLLOVER_SNAPSHOT_RETENTION: "2" },
    );
  }

  const snapshots = readdirSync(sessionDirectory(dataRoot, "retention-session")).filter(
    (name) => name.endsWith(".transcript.jsonl"),
  );
  assert.equal(snapshots.length, 2);
  const [pendingPath] = pendingFiles(dataRoot);
  const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
  assert.equal(existsSync(pending.checkpoint.snapshotPath), true);
  assert.equal(pending.compactionCount, 4);
});

test("reports checkpoint failure without blocking or arming a handoff", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const missingTranscript = path.join(root, "missing.jsonl");

  const first = runHook(
    dataRoot,
    postCompactEvent(root, missingTranscript, "session-failure", "turn-1"),
  );
  assert.equal(first.continue, true);
  assert.match(first.systemMessage, /could not be recorded/);

  const second = runHook(
    dataRoot,
    postCompactEvent(root, missingTranscript, "session-failure", "turn-2"),
  );
  assert.equal(second.continue, true);
  assert.match(second.systemMessage, /no handoff was armed/);

  const state = JSON.parse(
    readFileSync(
      path.join(sessionDirectory(dataRoot, "session-failure"), "state.json"),
      "utf8",
    ),
  );
  assert.equal(state.compactionCount, 2);
  assert.match(state.checkpointError, /ENOENT/);
  assert.equal(state.handoffArmed, false);
  assert.equal(pendingFiles(dataRoot).length, 0);
});

test("keeps compaction counts isolated by Codex session", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, transcriptWithUserAnchors(), "utf8");

  assert.deepEqual(
    runHook(dataRoot, postCompactEvent(root, transcriptPath, "session-one")),
    { continue: true },
  );
  assert.deepEqual(
    runHook(dataRoot, postCompactEvent(root, transcriptPath, "session-two")),
    { continue: true },
  );
});

test("ignores unrelated hook events without creating plugin data", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");

  const output = runHook(dataRoot, {
    hook_event_name: "SessionStart",
    source: "startup",
    session_id: "session-a",
    cwd: root,
  });
  assert.deepEqual(output, { continue: true });
  assert.equal(existsSync(dataRoot), false);
});
