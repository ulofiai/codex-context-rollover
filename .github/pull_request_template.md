## Problem

Describe the user-visible failure or missing behavior.

## Change

Explain the smallest change that solves it.

## Verification

- [ ] `node --check plugins/codex-context-rollover/scripts/context-rollover.mjs`
- [ ] `node --test test/post-compact.test.mjs`
- [ ] No real transcript, credential, token, private path, or runtime state is included
- [ ] Explicit `/clear` still consumes at most one handoff
- [ ] Ordinary `/new` and startup still receive no pending objective
