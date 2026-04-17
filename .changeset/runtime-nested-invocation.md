---
"@tisyn/runtime": minor
---

Host-side JS dispatch middleware can now invoke compiled Fns as journaled child coroutines via `ctx.invoke(fn, args, opts?)`. Child IDs come from the parent's unified `childSpawnCount` allocator (no namespace, no `.n`). Overlay frames pushed via `opts.overlay: { kind, id }` are visible only to the child subtree and are not journaled — observable from the runtime via `currentScopedEffectFrames()`. Abnormal child close — including cancelled — throws at the `yield* ctx.invoke(...)` await site in both live execution and replay; cancellation surfaces as `InvocationCancelledError`. Compiler-authored middleware's `ctx.invoke` support is out of scope for this release.
