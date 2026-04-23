---
"@tisyn/conformance": minor
---

`installMockDispatch(...)` now delegates its canned-effect return
through `runAsTerminal(effectId, data, liveWork)` from
`@tisyn/effects`. Under replay-fixture scenarios, the runtime's
terminal boundary substitutes stored results from the fixture's
`stored_journal`, and the mock's `effects` list is consumed only
for live-dispatch effects (advances `effectIndex` only when
`liveWork()` runs). This preserves fixture semantics for the three
fixture runners (`runEffectFixture`, `runReplayFixture`,
`runMixedFixture`) and aligns the mock with the scoped-effects
§9.5 middleware-author contract.
