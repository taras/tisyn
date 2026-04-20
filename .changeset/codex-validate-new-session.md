---
"@tisyn/codex": minor
---

**BREAKING:** `code-agent.newSession` against the Codex SDK adapter
or the Codex exec adapter now throws an `InvalidPayload` error when
the payload contains any key other than `model`. Previously such
payloads (e.g. `{ config: { model: "..." } }`) were silently accepted
and the adapter fell back to default model selection.

Dispatch the payload directly — `dispatch(CodeAgent.newSession({}))`
or `dispatch(CodeAgent.newSession({ model: "..." }))`.
