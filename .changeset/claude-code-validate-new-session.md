---
"@tisyn/claude-code": minor
---

**BREAKING:** `claude-code.newSession` against the Claude Code SDK
adapter or the ACP binding now throws an `InvalidPayload` error when
the payload contains any key other than `model`. Previously such
payloads (e.g. `{ config: { model: "..." } }`) were silently accepted
and the adapter fell back to default model selection.

Dispatch the payload directly — `dispatch(ClaudeCode.newSession({}))`
or `dispatch(ClaudeCode.newSession({ model: "..." }))`.
