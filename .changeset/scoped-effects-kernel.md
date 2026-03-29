---
"@tisyn/kernel": minor
---

Add `ProhibitedEffectError` and `StartEvent` for scoped effects.

- Add `ProhibitedEffectError` thrown when an IR middleware expression attempts to use any effect other than `dispatch`
- Add `StartEvent` type (`{ type: "start", coroutineId, inputs: { middleware?, args? } }`) to the `DurableEvent` union for recording durable execution inputs
