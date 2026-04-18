---
"@tisyn/runtime": minor
---

Host-side JS dispatch middleware can now invoke compiled Fns as journaled child coroutines via `invoke(fn, args, opts?)` (exported from `@tisyn/agent`). Child coroutineIds come from the parent's unified `childSpawnCount` allocator (`${parent}.${k}`, no namespace, no `.n`). Overlay frames pushed via `opts.overlay: { kind, id }` are visible only to the child subtree via `currentScopedEffectFrames()` and are not journaled. Abnormal child close — including cancelled — throws at the `yield* invoke(...)` await site in both live execution and replay; cancellation surfaces as `InvocationCancelledError`.
