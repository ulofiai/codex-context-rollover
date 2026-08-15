# Codex Context Rollover

[繁體中文](README.zh-TW.md)

A small, native Codex plugin that records a verifiable checkpoint whenever Codex compacts a task. Starting with the second compaction in the same task, it recommends `/new` before repeated lossy summaries cause context distortion or turn objective A into outcome B.

It is deliberately not a guardrail: the hook always returns `continue: true`. It never blocks compaction, stops a task, rewrites a prompt, or silently carries stale context into a new task.

## Install on a new computer

Requirements:

- Codex CLI or Codex desktop with plugin and hook support
- Node.js 20 or newer available as `node`
- Git

Add this repository as a Codex marketplace, then install the plugin:

```shell
codex plugin marketplace add ulofiai/codex-context-rollover
codex plugin add codex-context-rollover@codex-context-rollover
```

Restart Codex or open a new task. Run `/hooks` once and review/trust the plugin hook. Codex intentionally does not auto-trust third-party command hooks.

Hooks are enabled by default. If they were disabled on the new computer, set this in `~/.codex/config.toml`:

```toml
[features]
hooks = true
```

No machine-specific paths, existing project files, credentials, or prior state are required. Codex expands `${PLUGIN_ROOT}` to the installed plugin and provides `${PLUGIN_DATA}` as its writable data directory.

## What happens

1. Codex emits `PostCompact` after an automatic or manual compaction.
2. The plugin hashes the transcript up to its captured byte boundary and writes a small JSON checkpoint under `${PLUGIN_DATA}/sessions/<hashed-session-id>/`.
3. The first successful compaction is recorded silently.
4. The second and later compactions display a `/new` recommendation.
5. A recording error is surfaced immediately, but the task is never blocked.

Each checkpoint contains the local transcript path, byte length, SHA-256 digest, compaction count, timestamp, trigger, turn ID, and working directory. It does not copy the transcript content. The original Codex task remains the source record and stays available after `/new`.

The session ID is SHA-256 hashed before it is used as a directory name. Runtime records remain local and are never written into this Git repository.

## Configuration

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_CONTEXT_ROLLOVER_THRESHOLD` | `2` | First compaction count that displays the `/new` reminder |
| `CODEX_CONTEXT_ROLLOVER_LOCALE` | `zh-TW` | Use `en` for English messages |
| `CODEX_CONTEXT_ROLLOVER_DATA` | Codex `${PLUGIN_DATA}` | Test/development-only data-directory override |

## Updating or removing

Use the Codex plugin commands available in your installed version:

```shell
codex plugin list
codex plugin remove codex-context-rollover
codex plugin marketplace list
```

If you previously installed a project-local `PostCompact` hook with the same behavior, disable or remove that duplicate before enabling this plugin globally. Codex runs all matching hooks, so keeping both would record and notify twice.

## Development

```shell
npm test
```

The tests execute the real hook script in isolated temporary directories and cover successful checkpoints, repeated-compaction reminders, failed checkpoint recording, session isolation, and unrelated events. CI runs them on Windows, macOS, and Linux.

## License

[MIT](LICENSE)
