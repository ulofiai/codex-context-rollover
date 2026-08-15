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
const hookPath = path.join(
  repositoryRoot,
  "plugins",
  "codex-context-rollover",
  "scripts",
  "post-compact.mjs",
);

function runHook(dataRoot, event, extraEnv = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_DATA: dataRoot,
      CODEX_CONTEXT_ROLLOVER_LOCALE: "zh-TW",
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

test("records every compaction and recommends /new starting with the second", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  const transcript = '{"role":"user","content":"keep objective A"}\n';
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
  assert.match(second.systemMessage, /第 2 次內容壓縮/);
  assert.match(second.systemMessage, /\/new/);
  assert.match(second.systemMessage, /任務飄移/);

  const directory = sessionDirectory(dataRoot, "session-a");
  const state = JSON.parse(readFileSync(path.join(directory, "state.json"), "utf8"));
  assert.equal(state.compactionCount, 2);
  assert.equal(state.checkpointError, null);
  assert.equal(state.lastCheckpoint.byteLength, Buffer.byteLength(transcript));
  assert.equal(
    state.lastCheckpoint.sha256,
    createHash("sha256").update(transcript).digest("hex"),
  );

  const entries = readdirSync(directory);
  assert.equal(entries.filter((name) => /^\d{4}-.*\.json$/.test(name)).length, 2);
  assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
  assert.equal(entries.includes("state.lock"), false);
});

test("reports a checkpoint failure without blocking the task", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const missingTranscript = path.join(root, "missing.jsonl");

  const output = runHook(
    dataRoot,
    postCompactEvent(root, missingTranscript, "session-failure"),
  );
  assert.equal(output.continue, true);
  assert.match(output.systemMessage, /記錄失敗/);

  const state = JSON.parse(
    readFileSync(
      path.join(sessionDirectory(dataRoot, "session-failure"), "state.json"),
      "utf8",
    ),
  );
  assert.equal(state.compactionCount, 1);
  assert.match(state.checkpointError, /ENOENT/);
});

test("keeps compaction counts isolated by Codex session", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-context-rollover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "plugin-data");
  const transcriptPath = path.join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, "one task\n", "utf8");

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
    session_id: "session-a",
  });
  assert.deepEqual(output, { continue: true });
  assert.equal(existsSync(dataRoot), false);
});
