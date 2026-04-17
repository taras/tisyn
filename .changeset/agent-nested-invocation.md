---
"@tisyn/agent": minor
---

Host-side JS dispatch-boundary middleware bodies may now declare a third `ctx` argument exposing `ctx.invoke(fn, args, opts?)` — a runtime-controlled primitive that runs a compiled Fn as a child coroutine under the parent's unified allocator. `opts` is `{ overlay?: { kind, id }, label? }`. Replay and cancellation flow through the existing machinery. Existing 2-arg middleware is unaffected. Agent handlers cannot call `ctx.invoke` and throw `InvalidInvokeCallSiteError`. `Effects.around(middleware, options?)` and facade `.around(middleware, options?)` signatures and `{ at: 'min' | 'max' }` semantics are unchanged. Compiler-authored middleware (workflow-embedded `yield* Effects.around({ ... })`) is not changed in this release and does NOT support `ctx.invoke`; that path is deferred pending a source-doc decision on whether the compiler may be modified.
