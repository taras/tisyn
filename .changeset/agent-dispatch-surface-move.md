---
"@tisyn/agent": minor
---

BREAKING: the dispatch-boundary surface has moved to `@tisyn/effects` as a
direct package move with no compat window. `Effects`, `dispatch`, `resolve`,
`invoke`, `installCrossBoundaryMiddleware`, `getCrossBoundaryMiddleware`,
`InvalidInvokeCallSiteError`, `InvalidInvokeInputError`,
`InvalidInvokeOptionError`, `InvokeOpts`, and `ScopedEffectFrame` are no
longer exported from `@tisyn/agent`; import them from `@tisyn/effects`
instead. The authoring surface (`agent`, `operation`, `implementAgent`,
`useAgent`, `Agents`, `resource`, `provide`, plus types) is unchanged.
