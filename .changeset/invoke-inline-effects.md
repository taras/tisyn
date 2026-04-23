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

Also adds `runAsTerminal(effectId, data, liveWork)` — the public
delegation contract for `Effects.around({ dispatch })` middleware
that terminates the chain and performs effectful work. Terminal
middleware (agent implementations, remote transport bindings,
mocks, etc.) MUST compose its live work through `runAsTerminal` so
the runtime's replay-aware terminal boundary can substitute stored
results in place of re-running `liveWork()` on replay. See
`tisyn-scoped-effects-specification.md` §9.5 for the full
middleware-author contract.

Internals: `ctx.invokeInline` is added to the internal
`DispatchContext` seam on `@tisyn/effects/internal`; a new
`RuntimeTerminal` context + `RuntimeTerminalBoundary` interface is
exported on `@tisyn/effects/internal` for the runtime to install
per-dispatch. The built-in `EffectsApi` dispatch terminal routes
its `sleep` and "no agent registered" paths through `runAsTerminal`
so standalone uses gain the replay hook when the runtime is
installed.
