---
"@tisyn/runtime": patch
---

Lift the `timebox`, `all`, and `race` rejections inside
`invokeInline` bodies per §11.6 of the inline-invocation
specification. Step middleware can now use bounded and
concurrent child work inside shared-lifetime inline
execution without introducing a scope boundary.

- **`timebox` inside an inline body.** Allocates two child
  IDs from the inline lane's own counter —
  `laneId.{N}` (body) and `laneId.{N+1}` (timeout) — and
  delegates to the existing `orchestrateTimebox` helper.
  The orchestrator resolves with the tagged value
  `{ status: "completed", value }` on body-win and
  `{ status: "timeout" }` on timeout-win (timeout is NOT
  an error; it is a successful tagged value). Both the
  body child and the timeout child emit their own
  `CloseEvent`; the inline lane itself still emits none.
- **`all` and `race` inside an inline body.** Allocate
  `exprs.length` contiguous child IDs from the inline
  lane's own counter and delegate to the existing
  `orchestrateAll` / `orchestrateRace` helpers. Result
  ordering, first-winner propagation, and empty-list
  handling all match the runtime's pre-existing semantics.
- **Error routing.** Orchestrator errors (e.g. fail-fast
  propagation from `all`) are routed through
  `kernel.throw(err)` with the three-outcome pattern, so
  the inline body's own `try`/`catch` semantics work for
  these compounds the same way they do for standard-effect
  errors.
- **`provide` misuse framing.** An inline body yielding a
  bare `provide` outside a resource context throws
  `RuntimeBugError("provide outside resource context")` —
  framed as caller IR misuse (matching driveKernel), not
  as a "deferred inline compound".

`scope` inside an inline body remains rejected with a
clear error naming only it; its transport-binding
semantics (handler / bindings / scope boundary) need their
own review before lifting. The catch-all rejection message
is narrowed to the single-compound form.

No kernel / compiler / IR / durable-event-algebra changes;
no public API changes; `invokeInline` signature unchanged.
