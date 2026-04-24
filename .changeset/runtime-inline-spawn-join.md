---
"@tisyn/runtime": patch
---

Lift the Phase 5B rejection of `spawn` and `join` inside
`invokeInline` bodies per the inline-invocation spec's §11.5.

Step middleware can now start background child work from
inside shared-lifetime inline execution and have the
returned task handle be joinable from the inline body
itself, sibling inline lanes, or later caller code —
without creating an inline scope boundary.

The implementation shares the hosting dispatch site's
existing durable task table (the pair of `spawnedTasks` +
`joinedTasks` maps already maintained by `driveKernel` and
`orchestrateResourceChild` for ordinary-yield spawn/join)
with inline evaluation. No new inline-specific bookkeeping
system is introduced.

- **Spawn.** Inside an inline body, `spawn` allocates the
  child id from the lane's own `inlineChildSpawnCount` in
  `laneId.{m}` format and starts the child via
  `driveKernel(childKernel, childId, childEnv, ctx)`. The
  child task runs under the hosting caller's Effection scope
  — spawned via `yield* spawn(...)` inside the ambient
  middleware chain — and produces its normal `CloseEvent`
  under `laneId.{m}`. The inline lane itself still produces
  no `CloseEvent`.
- **Join.** Handles resolve against the hosting caller's
  `spawnedTasks` map; the double-join set is also shared, so
  the existing "already been joined" error fires whether
  both joins are from the inline body, from siblings, or
  across the caller boundary.
- **Resource-body hosts unchanged.** When a resource init or
  cleanup body hosts the dispatch, inline-body spawn/join
  attaches to THAT phase's durable task table — mirroring
  where ordinary-yield `spawn` from inside the resource body
  already lands.

`scope`, `timebox`, `all`, `race` inside inline bodies
remain rejected with a clear error. Nested resources inside
a resource body (from an inline-body `resource` yield in a
resource-init/cleanup context) remain rejected per Phase 5D.
No kernel/compiler/IR/durable-event-algebra changes; no
public API changes; `invokeInline` signature unchanged.
