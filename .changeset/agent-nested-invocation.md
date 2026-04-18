---
"@tisyn/agent": minor
---

Host-side JS dispatch middleware can invoke a compiled Fn as a journaled child coroutine via the new `invoke(fn, args, opts?)` helper from `@tisyn/agent`. Must be called from inside an active dispatch-boundary middleware body — agent handlers, `resolve` middleware, and facade `.around(...)` middleware all throw `InvalidInvokeCallSiteError`. `opts` is `{ overlay?: { kind, id }, label?: string }`. Replay, cancellation, and abnormal-close propagation flow through the existing kernel machinery. No change to `Effects.around(middleware, options?)` or facade `.around(middleware, options?)` signatures. Compiler-authored middleware does not yet expose `invoke`; that path is deferred pending a spec amendment.
