# Reviewer Notes

This directory is a small tracked note cache for Codex's recoverability.

Purpose:

- preserve active review context across sessions
- keep follow-up topics close to the repo
- record implementation completeness without scattering scratch notes elsewhere

Usage rules:

- keep notes short and factual
- prefer stable follow-up topics over long narrative logs
- update this file when the overall implementation picture changes materially
- keep code-changing plans in worktrees when possible; keep only durable reminders here

## Current Implementation Summary

Last reviewed: 2026-03-22

Verification baseline from the latest completeness pass on `main`:

- `pnpm build` passed
- `pnpm --filter @tisyn/conformance test` passed
- `pnpm --filter @tisyn/runtime test` failed
- `pnpm --filter @tisyn/agent test` failed to launch `vitest`

Current caution:

- PRs #8, #9, and #10 are merged.
- The repo now has declaration-based agents, contextual dispatch, `invoke()`, `executeRemote()`, and protocol types.
- `main` still has a runtime regression in the over-the-wire named-operation path.
- `@tisyn/agent` still needs a package-local test script that launches cleanly.

## Package Status

| Package                  | Status        | Notes                                                                                              |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------------- |
| `@tisyn/ir`              | `implemented` | Types, constructors, traversal, print, decompile, classify                                         |
| `@tisyn/kernel`          | `implemented` | Eval, env, resolve, unquote, canonical, errors, validation                                         |
| `@tisyn/runtime`         | `implemented` | Execute loop, replay/live dispatch, journaling, cancellation                                       |
| `@tisyn/compiler`        | `implemented` | Parse + emit + validation flow                                                                     |
| `@tisyn/agent`           | `partial`     | Declarations, implementations, contextual dispatch, `invoke()`; no transport runtime on `main` yet |
| `@tisyn/protocol`        | `implemented` | Types-only JSON-RPC/protocol package landed                                                        |
| `@tisyn/validate`        | `missing`     | Validation exists in kernel, not as a standalone boundary package                                  |
| `@tisyn/durable-streams` | `partial`     | In-memory stream/replay support only                                                               |
| `@tisyn/conformance`     | `implemented` | Conformance tests present                                                                          |
| `@tisyn/cli`             | `missing`     | No standalone CLI package                                                                          |

## Major Gaps

- standalone `@tisyn/validate`
- transport/session implementation on `main`
- richer agent runtime aligned with protocol lifecycle
- persistent durable backend beyond in-memory streams
- standalone CLI package

## Active Regression

- `packages/runtime/src/over-the-wire.test.ts:50` fails at `yield* invoke(invocation)` with `TypeError: yield* ... is not iterable`
- `packages/agent/src/invoke.ts` is intended to be the invocation-to-dispatch bridge for that path

## Follow-Up Topics

- [effectionx-process-epipe-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/effectionx-process-epipe-topic.md)
- [remote-execution-error-api-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/remote-execution-error-api-topic.md)
- [protocol-adapter-tests-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/protocol-adapter-tests-topic.md)
- [transport-future-phases.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/transport-future-phases.md)
- [ui-embedded-agent-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/ui-embedded-agent-topic.md)
- [sse-post-transport-topic.md](/Users/tarasmankovski/Repositories/cowboyd/tisyn/.reviewer/sse-post-transport-topic.md)

## Update Rule

- update `Last reviewed`
- rerun the narrowest meaningful verification set
- keep the package-status table and major-gaps list current
- add new follow-up topics as separate files instead of overloading this one
