---
"@tisyn/agent": minor
---

BREAKING (compat window open): the dispatch-boundary surface has moved to
`@tisyn/effects`. `Effects`, `dispatch`, `resolve`, `invoke`,
`InvalidInvokeCallSiteError`, `InvalidInvokeInputError`,
`InvalidInvokeOptionError`, `installCrossBoundaryMiddleware`, and
`getCrossBoundaryMiddleware` are still re-exported from `@tisyn/agent` with
`@deprecated` JSDoc for one release cycle; migrate your imports to
`@tisyn/effects` before the next release removes the re-exports. Class
identity is preserved across the boundary: `err instanceof
InvalidInvokeInputError` holds whether the class reference comes from
`@tisyn/agent` or `@tisyn/effects`. The authoring surface (`agent`,
`operation`, `implementAgent`, `useAgent`, `Agents`, `resource`, `provide`,
plus types) is unchanged.
