---
"@tisyn/runtime": minor
---

`@tisyn/runtime` no longer declares its own `DispatchContext`. The dispatch
boundary seam now has a single owner in `@tisyn/effects/internal`, eliminating
the silent name-keyed coupling between the two previous declarations.
`DispatchContext` is not and was not part of the runtime's public barrel;
users who imported it from a deep path must switch to
`@tisyn/effects/internal`, which is a workspace-intended subpath and is not
covered by public stability guarantees. Runtime consumers that previously
pulled `Effects`, `dispatch`, `resolve`, or `ScopedEffectFrame` through
`@tisyn/agent` should migrate those imports to `@tisyn/effects`.
