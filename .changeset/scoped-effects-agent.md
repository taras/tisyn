---
"@tisyn/agent": minor
---

Add scoped effects support to the agent package.

- Replace inlined `createApi` with `@effectionx/context-api@^0.5.3`, gaining `around(mw, { at: "min" | "max" })` priority API and live scope-walk inheritance via prototype chain traversal
- Add `EnforcementContext` and `installEnforcement()` for non-bypassable cross-boundary enforcement wrappers (distinct from `EffectsContext` so child scopes cannot bypass parent restrictions)
- Add `useAgent()` operation that returns a typed handle for an agent bound in the current scope via `useTransport()`
- Add `evaluateMiddlewareFn()` to drive IR function nodes with scope-local dispatch semantics (only `dispatch` effects permitted; all others throw `ProhibitedEffectError`)
