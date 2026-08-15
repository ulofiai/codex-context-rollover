# Security and local data

Codex Context Rollover makes no network requests and has no telemetry, account, token, or remote service. All checkpoints, pending handoffs, and transcript snapshots are written to the Codex-provided `PLUGIN_DATA` directory on the local computer.

Lossless transcript snapshots can contain source code, prompts, tool results, local paths, or secrets that were present in the Codex task. Treat the plugin data directory as sensitive user data. Do not commit, sync, or publish it.

The plugin:

- uses a SHA-256 digest instead of the raw session ID for directory names;
- uses atomic writes and scoped locks for mutable state;
- copies only the transcript prefix visible at the captured byte boundary;
- keeps a bounded number of lossless snapshots per source session;
- consumes handoffs once and refuses expired handoffs;
- never executes content read from a transcript.

To report a vulnerability without making it public, use this repository's GitHub Security Advisory reporting flow.
