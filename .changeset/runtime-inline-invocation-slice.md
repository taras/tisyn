---
"@tisyn/runtime": minor
---

Adds the runtime implementation for `invokeInline` as a core
slice against `tisyn-inline-invocation-specification.md` v6.
Dispatch-boundary middleware that calls
`invokeInline(fn, args, opts?)` now runs a compiled `Fn` as a
journaled inline lane under the caller's Effection scope:

- **Lane identity** — each accepted call allocates one lane id
  from the caller's unified `childSpawnCount` (shared with
  `invoke`, `spawn`, `resource`, `scope`, `timebox`, `all`,
  `race`). Rejected calls (invalid call site, non-`Fn` `fn`,
  non-array `args`, invalid `opts`) do not advance the
  allocator.
- **Journal shape** — standard-effect dispatches in the inline
  body journal under the lane coroutineId via the shared replay-
  aware dispatch helper. The lane itself produces no
  `CloseEvent` under any condition (normal completion, uncaught
  error, cancellation). No event is written for the
  `invokeInline` call itself on the caller's coroutineId.
- **Return and error propagation** — the inline body's kernel
  value is returned directly from the `Operation<T>`; uncaught
  errors propagate directly (no reification, unlike `invoke`).
- **Replay** — lane and caller cursors are independent; replay
  reconstructs both by deterministic re-execution of the same
  `invokeInline` sequence. Live and replay journals are
  byte-identical for the IL-R-001 subset.
- **Nested inline** — `invokeInline` called from middleware
  handling an effect dispatched during an outer inline body
  allocates a child lane with the `parentLane.{m}` format. Each
  lane in a nested subtree has its own independent allocator
  and cursor; no `CloseEvent` is produced at any level.
- **`invoke` inside inline** — retains full nested-invocation
  semantics: own scope, own `CloseEvent`, reified child result.

**Phase 5B scope limit.** The `driveInlineBody` helper
explicitly rejects, with a clear error, any descriptor it
cannot yet support safely:

- Every compound external (`scope`, `spawn`, `join`,
  `resource`, `timebox`, `all`, `race`) inside an inline body.
- `stream.subscribe` and `stream.next` inside an inline body —
  v6 §12.4 requires owner-coroutineId counter allocation for
  deterministic tokens; shipping a lane-local approximation
  would violate the landed spec. A follow-up phase will add
  owner-counter handling and lift the rejection.

Ordinary agent effects and `__config` dispatches inside an
inline body work normally.

Non-breaking: no existing `invoke`, agent, transport, or runtime
behavior changes. Existing replay/recovery/nested-invocation
test suites remain green. The spec's IL-INT-*, IL-RD-*,
IL-EX-*, and the full 31-test minimum acceptance subset are
future work.

Semantics per `tisyn-inline-invocation-specification.md`.
