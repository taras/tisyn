---
"@tisyn/effects": patch
---

Extend the internal `DispatchContext` seam with
`readonly ownerCoroutineId: string` so the runtime can
propagate capability-ownership identity through the
dispatch chain (inline lanes inherit the caller's owner;
`invoke` children reset to the child's own coroutineId).

`DispatchContext` is exported only from
`@tisyn/effects/internal` and has no stable-surface
contract; external consumers only interact with it via
`DispatchContext.with(undefined, ...)` to isolate agent
bodies, which is unchanged. The `invokeInline` public
helper signature is unchanged.

Paired with the runtime-side implementation that lifts
`stream.subscribe` / `stream.next` rejection inside
`invokeInline` bodies. See
`tisyn-inline-invocation-specification.md` §12.
