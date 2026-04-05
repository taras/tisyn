---
"@tisyn/agent": minor
---

Standardize middleware to single `Effects.around()` mechanism. `useAgent()` now returns an `AgentFacade` backed by a per-agent Context API with direct operation methods and `.around()` for per-operation middleware. Remove `EnforcementContext`, `installEnforcement`, and `EnforcementFn` — cross-boundary constraints flow through ordinary `Effects.around()` middleware. Simplify `dispatch()` to a direct alias of `EffectsApi.operations.dispatch`. Change `BoundAgentsContext` default from `null` to empty `Set<string>`.
