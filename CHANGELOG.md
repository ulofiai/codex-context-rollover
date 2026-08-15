# Changelog

All notable changes to Codex Context Rollover are documented here.

## 1.1.0 - 2026-08-15

- Save a byte-for-byte local transcript snapshot when the rollover threshold is reached.
- Extract verbatim original and recent user-message anchors without another AI summary.
- Use Codex's explicit `SessionStart source: clear` event for a one-time `/clear` handoff.
- Keep ordinary startup and `/new` sessions isolated from pending task intent.
- Expire pending handoffs and prune old lossless snapshots automatically.
- Remove npm/package metadata; runtime and verification use Node.js built-ins directly.

## 1.0.0 - 2026-08-15

- Detect automatic and manual Codex compaction through the native `PostCompact` hook.
- Record an atomic, SHA-256-verifiable transcript boundary after every compaction.
- Recommend `/new` from the second compaction onward to expose context-drift risk.
- Surface checkpoint failures without blocking or rewriting the active task.
- Keep session state local under Codex-provided plugin storage.
- Support Windows, macOS, and Linux with zero npm dependencies.
