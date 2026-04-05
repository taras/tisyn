---
"@tisyn/agent": minor
---

Standardize agent middleware around a single `Effects.around()` mechanism. `useAgent()` now returns an `AgentFacade` backed by a per-agent Context API with direct operation methods and `.around()` for per-operation middleware. Local bindings now use `Agents.use(declaration, handlers)`, and binding checks are routing-owned through `resolve()` rather than a separate bound-agent registry. Remove `BoundAgentsContext`, `EnforcementContext`, `installEnforcement`, and `EnforcementFn` so cross-boundary constraints flow through ordinary `Effects.around()` middleware.
