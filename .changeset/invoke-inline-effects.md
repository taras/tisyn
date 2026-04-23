---
"@tisyn/effects": minor
---

Add `invokeInline(fn, args, opts?)` for shared-lifetime inline
execution of a compiled `Fn` from `Effects.around({ dispatch })`
middleware. Unlike `invoke`, the inline body runs under the
caller's effective coroutine identity and scope — long-lived
resources acquired inside the body survive past the call's return
and up to the caller's own scope teardown. Inline-body yields are
recorded on a deterministic inline journal lane
(`${callerCoroutineId}@inline${q}.${j}`) per
`tisyn-inline-invocation-specification.md` §6.5.5; no new
`coroutineId` is allocated and no `CloseEvent` is written for the
call or the lane.

`invokeInline` MUST be called from dispatch-middleware dispatching
an effect on the caller's own coroutine cursor; calls from agent
handlers, `resolve` middleware, facade `.around` middleware, and
calls from middleware dispatching an inline-body effect (nested
inline) throw `InvalidInvokeCallSiteError` with zero side effects.

`ctx.invokeInline` is added to the internal `DispatchContext` seam
on `@tisyn/effects/internal`.
