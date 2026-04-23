---
"@tisyn/agent": minor
---

Terminal middleware installed by `implementAgent(...)` and
`Agents.use(...)` now delegates its live handler invocation
through `runAsTerminal(effectId, data, liveWork)` from
`@tisyn/effects`. Under replay, the runtime's terminal boundary
substitutes stored results in place of re-invoking the user's
handler — so agent operation handlers do not re-fire their side
effects on replay. See `tisyn-scoped-effects-specification.md`
§9.5 for the middleware-author contract. User-visible API is
unchanged; this update makes the built-in bindings exemplify the
contract.
