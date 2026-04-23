# Inline Invocation Implementor Handoff

This handoff is for the implementation work that follows PR #123. The PR only lands the normative spec/test-plan and cross-spec placement for `invokeInline`; it intentionally does not implement the runtime primitive.

## Product Goal

Users need multi-step workflows to keep long-lived resources alive across step boundaries. Browser smoke tests are the motivating case: login opens a page/session in one step, and later steps need to keep using that same page instead of losing it to a step-local child lifecycle.

Frame the implementation as adding the missing shared-lifetime primitive, not as fixing `invoke`. Existing `invoke` semantics remain correct for isolated nested execution.

## Normative Inputs

- `specs/tisyn-inline-invocation-specification.md`
- `specs/tisyn-inline-invocation-test-plan.md`
- `specs/tisyn-scoped-effects-specification.md` §3 cross-reference
- `specs/tisyn-nested-invocation-specification.md` §15 non-goal

The downloaded planner note remains useful background, but the committed `specs/` files are the implementation source of truth.

## Implementation Boundary

Implement `invokeInline` in the runtime/effects dispatch-boundary layer:

- export a free `invokeInline(fn, args, opts?)` helper from `@tisyn/effects`
- extend the internal `DispatchContext` seam with `invokeInline`
- implement runtime support in `packages/runtime/src/execute.ts` near `buildDispatchContext`
- reuse existing `InvokeOpts`, overlay stack handling, and `InvalidInvoke*` error family

Do not change:

- kernel descriptors or evaluation algebra
- compiler lowering or authored syntax
- durable event kinds
- existing `invoke` behavior
- public exposure of `DispatchContext`

## Required Semantics

`invokeInline` must evaluate the compiled `Fn` body in the caller's coroutine and Effection scope:

- no child coroutine id allocated for the call itself
- no new Effection scope boundary for the call itself
- no durable marker event and no inline-owned `CloseEvent`
- inline-body yields journal as caller `YieldEvent`s with contiguous caller `yieldIndex`
- resources/spawns/capabilities created inside the inline body are caller-owned
- `opts.overlay` applies only for the dynamic extent of the inline body
- uncaught inline-body errors propagate as the original thrown value

Operations inside the inline body still keep their own semantics. For example, `spawn`, `resource`, `timebox`, `scoped`, and nested `invoke` allocate children exactly as they would if written at the caller's program point.

## Recommended PR Sequence

1. Add API stub and the 14 minimum-acceptance tests from the test plan. The tests should fail on the expected stub error.
2. Implement call-site and input rejection with zero side effects.
3. Implement core inline evaluation, caller journal integration, allocator non-participation, and mixed `invoke`/`invokeInline` ordering.
4. Implement original-error propagation and explicit contrast tests against `invoke`.
5. Prove replay, cancellation, caller-owned resource lifetime, and caller-scope teardown.
6. Prove overlay scoping plus middleware, facade, and transport visibility.
7. Add Extended/Diagnostic tests and one product-facing example.

The core evaluator and journal integration should land together. Splitting them creates intermediate states that are observably wrong.

## MVP Gate

MVP is complete when the 14-test minimum subset in `tisyn-inline-invocation-test-plan.md` §5 passes and the existing nested-invocation tests remain green.

Run at minimum:

- `pnpm --filter @tisyn/runtime test`
- `pnpm --filter @tisyn/effects test`
- `pnpm run build`
- `pnpm run format:check`
- `pnpm run lint`

If any nested-invocation test regresses, stop and fix before continuing. `invoke` is the regression boundary.
