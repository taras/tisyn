---
"@tisyn/runtime": patch
---

Lift the Phase 5B rejection of `stream.subscribe` and
`stream.next` inside `invokeInline` bodies by implementing the
owner-coroutineId counter model from
`tisyn-inline-invocation-specification.md` §12.

- **Shared subscription counter across inline siblings and
  caller.** Subscription tokens are now allocated from a
  counter keyed by the dispatch chain's **owner coroutineId** —
  the original caller's coroutineId, captured once at the
  outermost `invokeInline` and inherited unchanged through
  nested inline calls. Sibling inline lanes and the caller
  itself share a single token namespace, so a handle acquired
  inside an inline body can be used by another sibling inline
  lane or by the caller after the inline returns, without
  spurious `SubscriptionCapabilityError` ancestry failures or
  token collisions.
- **`invoke` children keep their own namespace.** Per §12.8,
  an `invoke` child is its own owner: tokens allocated inside
  the child are prefixed with the child's coroutineId, and the
  caller cannot use handles that escape an `invoke` child
  (ancestry check correctly fails).
- **`stream.next` ancestry check compares owner identity**
  (not journal coroutineId). For ordinary dispatch where owner
  equals coroutineId, behavior is byte-identical to the prior
  release — no fixture changes in the stream-iteration or
  replay-dispatch suites.
- **Journal shape unchanged.** Stream YieldEvents continue to
  journal under the inline lane's coroutineId; owner identity
  lives only in runtime context and inside the opaque
  subscription-handle token string (which already encoded a
  coroutineId in the prior format). No new durable event
  kinds, no `ownerCoroutineId` field on `YieldEvent`, no
  kernel/compiler/IR changes.

Compound externals inside inline bodies (`scope`, `spawn`,
`join`, `resource`, `timebox`, `all`, `race`) remain rejected
with a clear error — lifting those is a follow-up phase.

Non-breaking for existing workloads: ordinary dispatch and
`invoke`-child subscription tokens keep their
`sub:<coroutineId>:<n>` shape. Semantics per
`tisyn-inline-invocation-specification.md` §12.
