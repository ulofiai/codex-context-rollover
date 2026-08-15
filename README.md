# Codex Context Rollover

> Lossless, one-command handoff after repeated Codex compaction.

[![Cross-platform verification](https://github.com/ulofiai/codex-context-rollover/actions/workflows/test.yml/badge.svg)](https://github.com/ulofiai/codex-context-rollover/actions/workflows/test.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[繁體中文](README.zh-TW.md)

Codex can compact a long-running task more than once. Repeated summaries can drop constraints or blur the original objective, while the task still looks normal. Codex Context Rollover adds the missing transition signal:

**compaction #2 → exact transcript snapshot → `/clear` → clean session receives exact user anchors once**

No extra AI summary is generated during rollover. The handoff is anchored to verbatim original and recent user messages, so objective A is not reinterpreted into B by another summarization pass. There is no polling, prompt wrapper, background service, npm package, or cloud account; the plugin uses only Node.js built-in modules.

## The gap it fills

| Codex alone | With Context Rollover |
| --- | --- |
| A compaction happens and work continues | The exact compaction count is tracked per task |
| The next continuation depends on another summary | Compaction #2 saves an exact byte-for-byte transcript snapshot |
| Clearing means manually rebuilding context | `/clear` receives the original and latest user-message anchors automatically |
| A normal new task can accidentally inherit stale intent | Only explicit `source: clear` consumes the short-lived handoff; `/new` receives nothing |
| Old recovery data can accumulate | Snapshot retention and handoff expiry clean themselves automatically |

The default second-compaction message is intentionally direct:

> Compaction #2: a lossless local rollover snapshot is armed. Run `/clear` within 30 minutes for a one-time handoff into a clean session. `/new` stays unrelated and receives no automatic carry-over.

This is a **handoff, not a guardrail**. Every result contains `continue: true`. It does not stop compaction, interrupt tools, rewrite prompts, or inject an old objective into an ordinary new task.

```text
PostCompact #2
    └─ exact local snapshot + SHA-256 + verbatim user anchors
         └─ short-lived, single-use handoff armed
              ├─ /clear  → clean session receives handoff once
              └─ /new    → receives nothing; remains unrelated
```

## Install on a clean computer

Requirements: Codex with plugin/hooks support, Git, and Node.js 20 or newer. `npm install` is not used.

```shell
codex plugin marketplace add ulofiai/codex-context-rollover
codex plugin add codex-context-rollover@codex-context-rollover
```

Restart Codex or open a new task, then run `/hooks` once to review and trust the command hook. Codex intentionally requires trust for third-party command hooks.

That is the entire installation. There are no machine-specific paths, project files, credentials, databases, or previous state to migrate.

## What is recorded

After every automatic or manual compaction, the plugin writes state under Codex's writable `${PLUGIN_DATA}` directory. From the configured threshold onward, it also saves an exact transcript snapshot and arms a workspace-scoped handoff:

```text
sessions/<sha256-of-session-id>/
├── state.json
├── 0002-<utc-timestamp>-<nonce>.json
└── 0002-<utc-timestamp>-<nonce>.transcript.jsonl
pending/
└── <sha256-of-working-directory>.json
```

Each checkpoint records:

- compaction count and timestamp;
- transcript path and captured byte boundary;
- SHA-256 of the transcript up to that boundary;
- trigger, turn ID, and working directory.

The pending handoff additionally stores the exact original and recent user-message anchors needed for one-time continuity.

The threshold snapshot is a **byte-for-byte local copy** up to the captured boundary. It never leaves the computer. Only the newest configured number of snapshots are retained, and the pending handoff expires automatically.

## What it solves—and what it does not

It solves the rollover problem without asking another model summary to summarize an already summarized task. `/clear` creates a genuinely clean Codex session, while `SessionStart source: clear` provides a safe, explicit signal to inject the single-use handoff. Verbatim user-message anchors preserve the original objective and latest constraints; the lossless snapshot remains available for evidence.

It does not click `/clear` for you or silently continue through `/new`. That one explicit command is the consent boundary that prevents a pending objective from leaking into an unrelated task.

### Why `/clear`, not `/new`

Codex exposes `/clear` as `SessionStart source: clear`, while an ordinary new task starts separately. Context Rollover matches only the explicit `clear` source, the same working directory, a short expiry, and one unconsumed handoff. That native distinction is what makes automatic continuation possible without globally guessing which old task a new conversation belongs to. See the [official Codex hooks event reference](https://learn.chatgpt.com/docs/hooks#sessionstart).

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_CONTEXT_ROLLOVER_THRESHOLD` | `2` | First compaction count that arms the `/clear` handoff |
| `CODEX_CONTEXT_ROLLOVER_LOCALE` | `zh-TW` | Set to `en` for English messages |
| `CODEX_CONTEXT_ROLLOVER_DATA` | Codex `${PLUGIN_DATA}` | Data-directory override for isolated testing |
| `CODEX_CONTEXT_ROLLOVER_HANDOFF_TTL_MINUTES` | `30` | How long `/clear` may consume the one-time handoff |
| `CODEX_CONTEXT_ROLLOVER_SNAPSHOT_RETENTION` | `2` | Lossless snapshots retained per source session |

## Privacy and failure behavior

- All runtime records and lossless snapshots stay on the local computer.
- Session IDs are SHA-256 hashed before becoming directory names.
- No network request, telemetry, token, or account is used.
- Atomic writes plus session and workspace locks protect concurrent state updates.
- Expired, consumed, or excess handoff data is not replayed.
- Recording errors are reported, but the task always continues.

## Verification

The repository tests the real installed hook behavior—not a mock—on Windows, macOS, and Linux. Coverage includes lossless snapshots, exact-anchor extraction, one-time `/clear` consumption, `/new`/startup isolation, expiry, automatic retention, recording failure, and per-session counting.

For maintainers, verification uses Node directly:

```shell
node --check plugins/codex-context-rollover/scripts/context-rollover.mjs
node --test test/post-compact.test.mjs
```

## Remove

```shell
codex plugin remove codex-context-rollover
```

If a project already has another `PostCompact` hook with the same behavior, disable that duplicate before enabling this plugin globally. Codex runs every matching hook.

## License

[MIT](LICENSE)
