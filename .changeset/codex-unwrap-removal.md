---
"@tisyn/codex": minor
---

**BREAKING:** The Codex adapter no longer accepts the legacy
single-parameter envelope shape (e.g. `{ args: { session, prompt } }`,
`{ config: {} }`, `{ handle }`, `{ session }`, `{ data }`). The
compiler now emits operation payloads unwrapped, and both the SDK
adapter and the exec adapter forward the effect payload directly to
the operation handler.

Callers dispatching against the Codex agent must use the unwrapped
payload shape — for example, dispatch `{ session, prompt }` to
`code-agent.prompt` instead of `{ args: { session, prompt } }`.
