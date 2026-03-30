---
"@tisyn/runtime": minor
---

Add scoped-effects runtime wiring to `execute()`.

- `execute()` now routes effects through the scope-local `Dispatch` middleware chain (enforcement wrappers, transport middleware) by calling `dispatch()` from `@tisyn/agent`
