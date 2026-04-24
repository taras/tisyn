---
"@tisyn/runtime": patch
---

Lift the Phase 5B rejection of `resource` inside `invokeInline`
bodies by completing the spec's §11.4 / §11.8 contract.

- **Provide in caller scope, cleanup at caller teardown.** A
  resource acquired inside an inline body now registers with
  the caller's resource list (the same list that holds the
  caller's ordinary resources), so reverse-order teardown runs
  as a single caller-level sequence. Sibling inline lanes and
  post-return caller code can reuse the resource until the
  caller exits. The resource child still produces its own
  `CloseEvent` under `laneId.{m}`; the inline lane itself
  still produces no `CloseEvent`.
- **Allocator discipline preserved.** The resource child id is
  allocated from the inline lane's own `inlineChildSpawnCount`;
  a rejected call does not advance the lane's allocator.
- **Nested resources still unsupported.** `invokeInline` called
  from a resource-init or resource-cleanup dispatch context
  continues to reject an inline-body `resource` yield with a
  clear error — preserving the existing "Nested resource is
  not supported" rule. `invokeInline` itself remains usable
  from those contexts for non-resource effects.
- **Other compound externals still rejected.** `scope`,
  `spawn`, `join`, `timebox`, `all`, `race` inside inline
  bodies remain rejected with a clear error naming the
  descriptor id; those remain follow-up phases.

No kernel/compiler/IR/durable-event-algebra changes. No new
public API. Semantics per
`tisyn-inline-invocation-specification.md` §11.
