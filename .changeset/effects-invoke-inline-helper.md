---
"@tisyn/effects": minor
---

Adds `invokeInline(fn, args, opts?)` as a public helper alongside
`invoke`. Dispatch-boundary middleware can now evaluate a compiled
`Fn` as an inline lane whose effects journal under a distinct
coroutineId for deterministic replay but share the caller's
Effection lifetime — no `CloseEvent` and no new scope boundary.
Return values and errors from the inline body propagate directly
to the caller's middleware frame (no reification, unlike `invoke`).

Call-site rules mirror `invoke`: `invokeInline` MUST be called
from inside a dispatch middleware body currently handling a
dispatched effect. Calls from agent handlers, `resolve`
middleware, facade `.around(...)` middleware, IR middleware, or
code outside any middleware throw `InvalidInvokeCallSiteError`
naming `invokeInline`. Invalid inputs (non-`Fn` `fn`, non-array
`args`, invalid `opts`) throw `InvalidInvokeInputError` /
`InvalidInvokeOptionError` without advancing the parent's
`childSpawnCount` allocator.

Non-breaking: no change to existing `invoke` behavior. The
`@tisyn/effects/internal` workspace seam gains a corresponding
required `invokeInline` method on `DispatchContext`; the runtime
(`@tisyn/runtime`) provides the implementation.

Semantics per `tisyn-inline-invocation-specification.md`.
