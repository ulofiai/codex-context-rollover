# Contributing

Thanks for helping make long Codex tasks easier to recover without changing their objective.

Useful contributions include:

- sanitized transcript-shape fixtures that expose a parsing edge case;
- Windows, macOS, or Linux portability fixes;
- incorrect rollover, expiry, retention, or `/new` isolation behavior;
- clearer installation and troubleshooting documentation;
- small changes that preserve the plugin's local-first, zero-dependency design.

## Protect private data

Never attach a real Codex transcript, credential, token, cookie, private repository path, or unredacted runtime state to an issue or pull request. Reproduce the shape with minimal synthetic messages instead.

## Verify a change

There is no package installation step. Use Node.js 20 or newer:

```shell
node --check plugins/codex-context-rollover/scripts/context-rollover.mjs
node --test test/post-compact.test.mjs
```

Behavior changes should add or update a process-level test. Tests should invoke the installed hook script and verify observable files and JSON output rather than mocking the core behavior.

## Pull requests

Keep each pull request focused on one problem. In the description, explain:

1. the user-visible failure or missing behavior;
2. why the change cannot leak a pending objective into ordinary `/new` or startup;
3. which command or test verifies the result.

The defining invariant is simple: rollover may help explicit `/clear` continue objective A, but it must never cause an unrelated task B to inherit A.
