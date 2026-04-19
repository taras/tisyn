---
"@tisyn/claude-code": minor
---

**BREAKING:** The Claude Code adapter no longer accepts the legacy
single-parameter envelope shape (e.g. `{ args: { session, prompt } }`,
`{ config: { model } }`, `{ handle: { sessionId } }`,
`{ session: { sessionId } }`, `{ data: forkData }`). The compiler now
emits operation payloads unwrapped, and both the ACP stdio adapter
and the SDK adapter forward the effect payload directly: ACP receives
it as top-level `params`; the SDK receives it as the operation input.

Callers dispatching against the Claude Code agent must use the
unwrapped payload shape — for example, dispatch
`{ session, prompt }` to `claude-code.plan` instead of
`{ args: { session, prompt } }`.
