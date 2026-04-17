# Tisyn Nested Invocation Test Plan

**Status.** Companion test plan to `tisyn-nested-invocation-specification.md`.
**Validates.** Spec version: MVP (final).
**Tiering.** Tier 1 (normative conformance) + Tier 2 (diagnostic / prototype-gate).

---

## 1. Overview

This test plan validates the settled semantics defined by `tisyn-nested-invocation-specification.md`. It does not redesign the feature, introduce alternative boundary models, or propose new semantics.

A runtime implementation is conformant with respect to nested invocation if and only if it passes all Tier 1 tests in this plan. Tier 2 tests are diagnostic; they strengthen confidence in the implementation and catch anti-patterns but do not by themselves determine conformance.

**Scope of this plan.** Local nested invocation — a middleware body on the runtime-controlled dispatch boundary calling `ctx.invoke(fn, args, opts)` to execute a compiled `Fn` as a child coroutine.

**Out of scope.** Subordinate remote execution (the non-normative forward-compatibility note in spec §14 is not a conformance target); concurrent `ctx.invoke` composition within one middleware body (deferred per spec §15); per-invocation narrower timebox or agent rebinding (deferred per spec §15).

---

## 2. Normative basis

This plan validates the nested-invocation specification as derived from the following normative sources:

- **`tisyn-nested-invocation-specification.md`** — primary spec; §§1–13, §15, §16. §14 is non-normative and not tested.
- **`tisyn-scoped-effects-specification.md` §9** and its Core-tier companion test **MR-002** — the replay-transparency property that invoking middleware re-executes identically on replay. Inherited by direct citation in nested-invocation spec §8.2.
- **`tisyn-kernel-specification.md` §10.5** — parent kernel re-evaluates IR on replay; at external yield points, the runtime feeds journaled outcomes. Inherited by nested-invocation spec §8.1.
- **`tisyn-compound-concurrency-specification.md`** — §4.2 (unified child allocator, `parentId.{k}` format, invariant I-ID); §9 (ordering); §10.1, §10.3 (per-coroutineId replay cursors; complete/partial/empty journal behaviors); §10.4 (divergence); §10.6.2 (Durable Yield Rule). All inherited by nested-invocation spec §§6, §8, §12.
- **`tisyn-timebox-specification.md` §8.2** — timebox consumes +2 counter advancement per invocation; basis for mixed-accounting tests.
- **`tisyn-spawn-specification.md` §A.1** — per-coroutineId replay cursor model precedent.

This plan validates the nested-invocation spec as derived from these rules. It does not restate requirements from other specs; those are already validated by their own companion test plans.

---

## 3. Harness assumptions

Minimal harness capabilities required to execute this plan:

- **H-A1. Journal inspection.** Ability to enumerate durable events (`YieldEvent`, `CloseEvent`) in appended order, with each event's `coroutineId` and payload visible.
- **H-A2. Per-coroutineId sub-stream extraction.** Ability to filter the journal by `coroutineId` and walk the resulting sub-stream in append order.
- **H-A3. Replay/restart harness.** Ability to persist a journal to bytes, tear down the runtime, instantiate a fresh runtime (in the same process or a different process), and drive execution against the persisted journal.
- **H-A4. Side-effect counters at the agent layer.** Ability to observe, per agent operation, how many times its handler was invoked during a run. Used to assert "agents not re-dispatched on replay."
- **H-A5. Middleware entry probe.** Ability to register a non-intrusive probe that records each entry into a middleware body, scoped to the test. Used to operationalize MR-002's "middleware fires on both runs" property.
- **H-A6. Controlled cancellation.** Ability to deliver a cancellation signal to a running parent coroutine at a chosen point during test execution.
- **H-A7. Controlled error injection.** Ability to cause a specific effect dispatch inside a child to fail with a chosen reified error.
- **H-A8. Blocking effect fixture.** Ability to provide a controllable effect whose dispatch blocks until the test releases it.
- **H-A9. Fn content-hash inspection.** Ability to read a compiled `Fn`'s content hash. Used by Tier 2 diagnostic tests only.
- **H-A10. Cross-process journal persistence.** A superset of H-A3; used by the restart-stability test.

Probes and counters are harness-scoped. No test asserts that the runtime exposes these to user code.

---

## 4. Tiering rules

**Tier 1 (normative conformance).** A test is Tier 1 if and only if a correct implementation of the normative specification MUST pass it. Tier 1 failure indicates non-conformance with a `MUST`-level requirement. All Tier 1 tests must pass for an implementation to claim conformance.

**Tier 2 (diagnostic / prototype-gate).** A test is Tier 2 if it:
- exercises a straw-implementation or anti-pattern rather than the production runtime (e.g., negative tests against a deliberately non-conformant fixture), or
- reinforces an assumption that the spec relies on but does not itself require (e.g., `Fn` content-hash stability), or
- provides diagnostic evidence for a normative property already covered by a Tier 1 test.

Tier 2 failure is informative. It is not, by itself, a conformance failure. Tier 2 tests may be promoted to Tier 1 by a later spec amendment, but they are not conformance gates as written.

---

## 5. Test catalog

### 5.1 Tier 1 — normative conformance

---

#### T01 — `invoke_writes_child_events_to_journal`

- **Tier.** 1.
- **Purpose.** Verify the basic journal shape of a single nested invocation: child events under the child coroutineId, no parent event for `ctx.invoke` itself, child close ordered before parent close.
- **Setup.**
  - A root parent coroutine with `coroutineId = "root"`.
  - One `Effects.around()` middleware that, when dispatched, calls `yield* ctx.invoke(body, [state])`.
  - `body` is a compiled `Fn` that yields two trivial agent effects `E1`, `E2` and returns `42`.
  - `state` is a literal `Val`.
- **Execution.** Run parent to completion with a fresh journal.
- **Assertions.**
  - The parent's outer host-effect `YieldEvent` appears under `coroutineId = "root"`.
  - Exactly two `YieldEvent` entries appear under `coroutineId = "root.0"` corresponding to `E1`, `E2`, in order.
  - Exactly one `CloseEvent` appears under `coroutineId = "root.0"` with normal close reason and value `42`.
  - No `YieldEvent` or `CloseEvent` is written under `"root"` that represents the `ctx.invoke` call itself.
  - The parent outer host-effect `CloseEvent` follows `"root.0"`'s `CloseEvent` in journal order.
- **Validates.** Spec §6.2, §6.6, §7.5, §7.6, §12.2; H1, H2, H7.
- **Harness.** H-A1, H-A2.

---

#### T02 — `replay_reproduces_invocation_without_divergence`

- **Tier.** 1.
- **Purpose.** Verify replay equivalence: same terminal state, no divergence, agent side effects not duplicated on replay.
- **Setup.** Identical to T01. Agent operation backing `E1`, `E2` instruments a side-effect counter via H-A4.
- **Execution.** Run to completion with a fresh journal; persist the journal; instantiate a fresh runtime; replay against the persisted journal.
- **Assertions.**
  - Replay reports no divergence.
  - Terminal parent value on replay equals terminal parent value on original run.
  - Agent side-effect counter increments by 2 on the original run and by 0 on the replay (per Durable Yield Rule).
- **Validates.** Spec §8.1, §8.2, §8.3, §8.4, §8.5; H3.
- **Harness.** H-A1, H-A3, H-A4.

---

#### T03 — `child_supports_multiple_yielded_effects`

- **Tier.** 1.
- **Purpose.** Verify that the invoked child can yield multiple effects of varied kinds through the parent's inherited routing.
- **Setup.**
  - `body` yields five effects: two user agent effects, two agent-facade-routed effects, one scoped-effect-observing effect that observes the current scoped-effect stack.
  - No overlay supplied.
- **Execution.** Run to completion; persist; replay.
- **Assertions.**
  - All five `YieldEvent`s appear under `"root.0"` in declared order.
  - Agent-facade-routed effects observe the same agent binding present in the parent's scope.
  - The scoped-effect-observing effect observes the inherited parent scoped-effect stack (no overlay frame present).
  - Replay reproduces without divergence.
- **Validates.** Spec §7.3, §7.5; H1, H3.
- **Harness.** H-A1, H-A3, H-A5 (for agent-binding observation fixture).

---

#### T04 — `child_error_propagates_as_invoke_throw`

- **Tier.** 1.
- **Purpose.** Verify abnormal child close surfaces as an Effection-level exception at the `yield* ctx.invoke(...)` await site, and that overlay is popped before throw.
- **Setup.**
  - `body` first yields one effect `E1` (succeeds), then yields effect `E2` which is configured to throw a reified error `{ name: "E2Err", message: "boom" }` via H-A7.
  - `opts.overlay = { kind: "test-overlay", id: "ov1" }`.
  - Invoking middleware wraps the `yield*` in a JS `try/catch` and records what is caught.
- **Execution.** Run parent; observe caught value and final journal.
- **Assertions.**
  - The invoking middleware catches an Effection-level exception whose payload matches the reified error from `E2`.
  - The child's `CloseEvent` under `"root.0"` carries the abnormal close reason reflecting `E2Err`.
  - An observing scoped-effect probe yielded from the parent scope after `ctx.invoke` returns does NOT see the `test-overlay` frame (pop executed before throw).
  - Replay reproduces the identical caught-value content and identical journal.
- **Validates.** Spec §7.7, §10.1, §10.2, §10.3; H4.
- **Harness.** H-A1, H-A3, H-A5, H-A7.

---

#### T05 — `parent_cancellation_propagates_to_active_child`

- **Tier.** 1.
- **Purpose.** Verify parent cancellation reaches the invoked child, teardown runs, child emits cancelled close, and the invoking middleware observes cancelled propagation.
- **Setup.**
  - `body` yields a blocking effect (H-A8) wrapped in a `try { ... } finally { yield* trace("B-teardown"); }`.
  - Invoking middleware wraps the `yield* ctx.invoke(...)` in `try { ... } finally { observe("M-teardown"); }`.
- **Execution.** Start parent; wait until the blocking effect is pending; deliver cancellation to the parent via H-A6.
- **Assertions.**
  - The child's `finally` trace effect `"B-teardown"` is journaled under `"root.0"` before the child's `CloseEvent`.
  - The child's `CloseEvent` under `"root.0"` carries close reason `cancelled`.
  - The invoking middleware's `M-teardown` probe fires after `ctx.invoke` rejects with cancelled.
  - The parent's own `CloseEvent` follows all child events.
  - Replay reproduces the same journal in the same order.
- **Validates.** Spec §11.1, §11.2, §11.3; H5.
- **Harness.** H-A1, H-A3, H-A6, H-A8.

---

#### T06 — `multiple_sequential_invocations_in_one_middleware`

- **Tier.** 1.
- **Purpose.** Verify sequential `ctx.invoke` calls in one middleware body allocate consecutive child IDs with strict event serialization.
- **Setup.**
  - Invoking middleware performs three sequential `yield* ctx.invoke(Fi, [])` calls for `F1`, `F2`, `F3`, each yielding one distinct effect and returning a distinct value.
  - No overlay.
- **Execution.** Run; persist; replay.
- **Assertions.**
  - Three distinct child coroutineIds appear: `"root.0"`, `"root.1"`, `"root.2"`, in that order.
  - Events under `"root.0"` fully precede any event under `"root.1"`; events under `"root.1"` fully precede any event under `"root.2"`.
  - Each child has exactly one `CloseEvent` with the expected value.
  - Replay produces byte-identical coroutineIds and event ordering.
- **Validates.** Spec §6.2, §6.5, §6.6, §7.1, §12.3; H2.
- **Harness.** H-A1, H-A2, H-A3.

---

#### T07 — `state_flows_into_child_and_result_flows_out`

- **Tier.** 1.
- **Purpose.** Verify argument and result pass-through round-trips faithfully across the `ctx.invoke` boundary.
- **Setup.**
  - `body` takes `state` and returns `f(state)` where `f` is a deterministic kernel-level transform (e.g., `state.x * 2 + 1`).
  - Multiple test inputs: primitive, structured object, nested array.
- **Execution.** For each input, run and inspect the invoking middleware's returned value and the child's `CloseEvent` value.
- **Assertions.**
  - For each input, child observes exactly the passed `state` as its argument (verified via an echo probe inside `body`).
  - Invoking middleware receives exactly `f(state)` from `yield* ctx.invoke(...)`.
  - No hidden reference leakage: mutating the input after the call has no effect on the journaled value (serializability).
- **Validates.** Spec §5.5, §7.2, §7.8.
- **Harness.** H-A1.

---

#### T08 — `middleware_and_agent_routing_are_inherited_by_child`

- **Tier.** 1.
- **Purpose.** Verify the child inherits the parent's middleware stack, agent binding, and transport bindings without requiring explicit propagation.
- **Setup.**
  - Parent scope installs one telemetry `Effects.around()` middleware tagging every dispatched effect with a serial counter and a transport binding for agent `A`.
  - `body` yields two agent-`A`-bound effects.
- **Execution.** Run; inspect telemetry trace and transport dispatch records.
- **Assertions.**
  - Telemetry entries appear for each child-yielded effect in correct relative order.
  - Agent `A`'s transport handles each child effect.
  - Replay reproduces the same middleware-trace shape.
- **Validates.** Spec §7.3, §7.5.
- **Harness.** H-A1, H-A3, H-A5.

---

#### T09 — `ordering_sensitive_journal_test`

- **Tier.** 1.
- **Purpose.** Verify per-coroutineId sub-stream contiguity when parent-level siblings each perform nested invocations.
- **Setup.**
  - Parent invokes `all([hostOpA, hostOpB])` at IR level.
  - `hostOpA`'s host-effect middleware calls `ctx.invoke(F_A, [])`; `hostOpB`'s host-effect middleware calls `ctx.invoke(F_B, [])`.
  - Given compound concurrency §4.2 allocation order, expected child IDs: `hostOpA = "root.0"`, `hostOpB = "root.1"`, `F_A` is a child of `"root.0"` at ID `"root.0.0"`, `F_B` is a child of `"root.1"` at ID `"root.1.0"`.
- **Execution.** Run; persist; replay.
- **Assertions.**
  - Each sub-stream keyed by a single coroutineId is totally ordered within itself.
  - Across sub-streams, interleaving of `"root.0.0"` and `"root.1.0"` events in the global journal is permitted, but the within-stream order of each is preserved.
  - `"root.0.0"`'s `CloseEvent` precedes `"root.0"`'s next event and `"root.0"`'s `CloseEvent`. Same for `"root.1.0"` within `"root.1"`.
  - Replay reproduces the exact journal, including the interleave.
- **Validates.** Spec §12.1 (compound concurrency §9 inherited); H1.
- **Harness.** H-A1, H-A2, H-A3.

---

#### T10 — `replay_cursor_and_identity_stability_under_restart`

- **Tier.** 1.
- **Purpose.** Verify deterministic child coroutineIds and per-coroutineId cursor stability across process restart.
- **Setup.** Use T01's fixture. Persist the produced journal to bytes; tear down the runtime process; instantiate a fresh runtime process; reload the journal bytes.
- **Execution.** Replay from the persisted journal in the fresh process.
- **Assertions.**
  - Child coroutineId observed on replay is byte-identical to the original run's.
  - Per-coroutineId cursor advances through `"root.0"`'s events in the same order.
  - No agent side effect is re-triggered.
- **Validates.** Spec §6.5, §8.3, §8.4; H3.
- **Harness.** H-A1, H-A4, H-A10.

---

#### T11 — `child_close_event_shape_and_placement`

- **Tier.** 1.
- **Purpose.** Verify each terminal close variant produces exactly one `CloseEvent` under the child coroutineId, placed before the parent's close, with no new event kinds introduced.
- **Setup.** Three variants of `body`:
  1. returns normally with a value.
  2. throws uncaught (via H-A7).
  3. is cancelled mid-execution (via H-A6 into a blocking fixture).
- **Execution.** Run each variant.
- **Assertions.**
  - For each variant, exactly one `CloseEvent` appears under the child coroutineId.
  - Close reasons are, respectively, `ok` with value, `error` with reified cause, `cancelled`.
  - In no variant does an additional durable event kind appear.
  - No `CloseEvent` under the child coroutineId appears after the parent's own `CloseEvent`.
- **Validates.** Spec §7.5, §7.6, §12.2; H1.
- **Harness.** H-A1, H-A6, H-A7, H-A8.

---

#### T12 — `overlay_scope_is_child_subtree_only`

- **Tier.** 1.
- **Purpose.** Verify `opts.overlay` is visible only within the child's subtree and is popped strictly when `ctx.invoke` returns or throws.
- **Setup.**
  - Parent scope has no prior `test-overlay` frame.
  - Invoking middleware calls `ctx.invoke(body, [], { overlay: { kind: "test-overlay", id: "ov1" } })`.
  - `body` yields a scoped-effect-observing probe that returns the current scoped-effect stack.
  - Parent then yields a second scoped-effect-observing probe after `ctx.invoke` returns.
- **Execution.** Run.
- **Assertions.**
  - Child probe observes `test-overlay` frame `ov1` present in its stack.
  - Parent probe (after return) observes a stack that does NOT contain `test-overlay` frame `ov1`.
- **Validates.** Spec §7.4, §7.7.
- **Harness.** H-A1, H-A5.

---

#### T13 — `middleware_reexecutes_on_replay_with_invoke`

- **Tier.** 1.
- **Purpose.** Operationalize MR-002 for nested invocation: invoking middleware re-executes identically on replay with no observable difference, and child agents are not re-dispatched for journal-complete effects.
- **Setup.**
  - T01 fixture. Install a harness middleware-entry probe (H-A5) recording each entry into the invoking middleware body.
  - Agent side-effect counter from H-A4.
- **Execution.** Run to completion; persist; replay.
- **Assertions.**
  - Middleware-entry probe records at least one entry on the original run and at least one entry on the replay pass (middleware re-executes per MR-002).
  - Agent side-effect counter increments by 2 on the original run and by 0 on the replay.
  - `yield* ctx.invoke(...)` returns the same value on the original run and on replay.
- **Validates.** Spec §8.2, §8.5; H6.
- **Harness.** H-A1, H-A3, H-A4, H-A5.

---

#### T14 — `overlay_replay_equivalence`

- **Tier.** 1.
- **Purpose.** Verify `opts.overlay` is not independently journaled yet replay reproduces the identical overlay value and observation inside the child.
- **Setup.**
  - Invoking middleware computes `overlay` as a pure function of its inputs (e.g., `{ kind: "checkpoint", id: hash(args) }`) and passes it via `opts.overlay`.
  - `body` yields a scoped-effect-observing probe that records the overlay frame content.
- **Execution.** Run; persist; replay.
- **Assertions.**
  - On both runs, the child probe observes a byte-identical overlay frame.
  - The journal contains no standalone entry that encodes the overlay value (assert by enumerating all event kinds and confirming only `YieldEvent` and `CloseEvent` with non-overlay payloads).
- **Validates.** Spec §9.1, §9.2, §9.3.
- **Harness.** H-A1, H-A3, H-A5.

---

#### T15 — `mixed_kernel_and_invoke_unified_counter`

- **Tier.** 1. **Load-bearing.**
- **Purpose.** Verify the unified parent-owned allocator advances monotonically across mixed kernel-origin and middleware-origin allocations. A namespaced-allocator implementation MUST fail this test.
- **Setup.**
  - Parent coroutine with the following program-order sequence:
    1. Middleware calls `ctx.invoke(F1, [])` inside the host operation serving the first parent-level effect.
    2. Parent IR evaluates `all([A, B])`.
    3. Middleware calls `ctx.invoke(F2, [])` inside the host operation serving the next parent-level effect after `all` completes.
- **Execution.** Run; persist; replay.
- **Assertions.**
  - Expected child coroutineIds in allocation order: `F1 = "root.0"`, `A = "root.1"`, `B = "root.2"`, `F2 = "root.3"`.
  - No child ID contains `.n` or any namespace-separator variant.
  - Parent's `childSpawnCount` end value is `4`.
  - Replay reproduces the same IDs byte-identically.
  - A harness detector that scans all observed coroutineIds in the journal MUST NOT find any ID pattern outside `parentId.{integer}` under the parent.
- **Validates.** Spec §6.1, §6.3, §6.4, §6.5, §6.6; H2.
- **Harness.** H-A1, H-A2, H-A3.

---

#### T16 — `invoke_from_non_middleware_is_error`

- **Tier.** 1.
- **Purpose.** Verify `ctx.invoke` called outside an active dispatch-boundary middleware produces a runtime error and allocates no child coroutineId.
- **Setup.** Two sub-fixtures:
  1. A synthesized call site in a leaf agent operation handler attempting `ctx.invoke`.
  2. A synthesized call site outside any dispatch context, with an attempted reach into a stale `ctx`.
- **Execution.** Run each sub-fixture.
- **Assertions.**
  - Each sub-fixture surfaces a runtime error.
  - Parent's `childSpawnCount` is unchanged after each failed attempt.
  - No `coroutineId` of the form `parentId.{k}` for the expected `k` appears in the journal.
  - Replay reproduces the same error condition when applicable.
- **Validates.** Spec §3, §5.3.1, §5.3.2, §5.3.3.
- **Harness.** H-A1. Straw-site probes may live in the test harness; they are not exposed to user code.

---

#### T17 — `timebox_and_invoke_counter_accounting`

- **Tier.** 1. **Load-bearing.**
- **Purpose.** Verify mixed-origin counter accounting with a timebox (which advances by +2) correctly interleaved between nested invocations (which advance by +1 each). A namespaced-allocator implementation MUST fail this test.
- **Setup.**
  - Parent coroutine with the following program-order sequence:
    1. Middleware calls `ctx.invoke(F1, [])`.
    2. Parent IR evaluates `timebox(1000, bodyT)` where `bodyT` yields a single effect and returns before timeout.
    3. Middleware calls `ctx.invoke(F2, [])`.
- **Execution.** Run; persist; replay.
- **Assertions.**
  - Expected child coroutineIds in allocation order: `F1 = "root.0"`, `timebox body = "root.1"`, `timebox timeout = "root.2"`, `F2 = "root.3"` (per `tisyn-timebox-specification.md` §8.2 TB-R2a–TB-R2d consumed indices).
  - Parent's final `childSpawnCount` is `4`.
  - Replay reproduces the same IDs byte-identically.
- **Validates.** Spec §6.3, §6.4, §6.5, §6.6 against `tisyn-timebox-specification.md` §8.2; H2.
- **Harness.** H-A1, H-A3.

---

### 5.2 Tier 2 — diagnostic / prototype-gate

---

#### T18 — `negative_raw_kernel_bypass_is_non_conformant`

- **Tier.** 2. **Diagnostic.**
- **Purpose.** Demonstrate that a straw implementation which drives a child kernel directly from middleware (bypassing `ctx.invoke`) produces either journal gaps or agent side-effect duplication on replay. This is a negative test against a non-conformant fixture, used to reinforce that the runtime must own journal writes and child allocation.
- **Setup.**
  - A non-conformant middleware body that instantiates a kernel directly for `body`, drives it locally, and either (a) does not journal child events, or (b) routes yielded effects through the runtime dispatch without the runtime observing a child allocation.
- **Execution.** Run to completion; persist whatever was written; attempt replay.
- **Assertions.**
  - Either (a) the journal lacks events that the child produced (replay surfaces no child activity), or (b) the agent side-effect counter increments on both the original run and the replay (re-dispatch because no durable child yield was recorded).
  - A conformance validator detects the anomaly and reports it.
- **Notes.** Tier 2 because the production runtime is not the subject; the test exists to document the anti-pattern.
- **Validates.** Diagnostic reinforcement of spec §3, §5.3, §7.5, §7.6; reinforcement of the Durable Yield Rule coverage in T02/T13.
- **Harness.** H-A1, H-A3, H-A4. Straw kernel-bypass fixture is test-local.

---

#### T19 — `fn_identity_stability_gate`

- **Tier.** 2. **Prototype-gate.**
- **Purpose.** Reinforce invariant I-ID by verifying that `Fn` content-hash identity is stable across independent builds of the same source.
- **Setup.** Two independent builds of the identical source producing the same compiled `Fn`. Run the T01 fixture against each build. Persist both journals.
- **Execution.** Cross-replay: replay build-A's journal on build-B's runtime and vice versa.
- **Assertions.**
  - Observed `Fn` content hashes are byte-identical across builds.
  - Child coroutineIds are byte-identical across cross-replay.
- **Notes.** Tier 2 because this gates an assumption that the spec relies on but does not itself specify. Promotion to Tier 1 would require a content-hash-stability normative requirement in the compiler spec.
- **Validates.** Diagnostic reinforcement of spec §6.5.
- **Harness.** H-A1, H-A3, H-A9, H-A10.

---

## 6. Load-bearing requirements covered

This plan explicitly treats the following as load-bearing requirements validated by Tier 1 tests:

- **No parent event for the `ctx.invoke` call itself.** Covered by T01 (positive) and T16 (negative non-advance on error). Spec §7.6, H7.
- **Child writes its own `YieldEvent` / `CloseEvent` stream.** Covered by T01, T03, T11. Spec §7.5, §7.6.
- **Replay does not re-dispatch durable child yields.** Covered by T02, T13. Spec §8.5 (Durable Yield Rule inherited).
- **Invoking middleware re-executes on replay under MR-002 inheritance.** Covered by T13. Spec §8.2; H6.
- **Unified allocator across mixed origins.** Covered by T15 (mixed kernel + invoke), T17 (mixed timebox + invoke). Spec §6.3; H2.
- **No `.n` namespace or alternate separator.** Covered by T15, T17 explicit scan assertions. Spec §6.6.
- **Invalid non-middleware call allocates no child coroutineId.** Covered by T16. Spec §5.3.3.
- **Timebox mixed-accounting uses the same unified allocator.** Covered by T17. Spec §6.3 against `tisyn-timebox-specification.md` §8.2.
- **Overlay push/pop is child-scoped and replay-equivalent.** Covered by T12 (scope), T14 (replay equivalence), T04 (pop on throw). Spec §7.4, §7.7, §9.2.

---

## 7. Ambiguity-surface record

Two ambiguities were surfaced during test derivation. Both are resolved in the settled spec text and are validated here:

- **Overlay pop ordering on exception.** Resolved in spec §7.4, §7.7: the runtime owns the push/pop bracket and pop MUST occur before `ctx.invoke` returns or throws. Validated by T04 (pop on throw) and T12 (scope correctness on normal return).
- **Counter advancement point on runtime error.** Resolved in spec §5.3.3: a call that is rejected as invalid MUST NOT advance the unified allocator. Validated by T16 (`invoke_from_non_middleware_is_error`).

No other ambiguities remained at the time of this plan's derivation.

---

## 8. Tier discipline audit

- **T13 (`middleware_reexecutes_on_replay_with_invoke`) is Tier 1.** It is the direct operationalization of MR-002 (Core tier in the scoped-effects companion test plan) applied to middleware that contains `ctx.invoke`. The underlying property is already Core-tier normative; the inheritance is explicit in nested-invocation spec §8.2. Classifying T13 as Tier 2 would under-state the conformance requirement.
- **T18 (`negative_raw_kernel_bypass_is_non_conformant`) is Tier 2.** The subject of the test is a deliberately non-conformant straw implementation, not the production runtime. A Tier 1 test cannot assert conformance properties of an implementation designed to violate conformance. The test remains valuable as a diagnostic and documents the anti-pattern.
- **T15 (`mixed_kernel_and_invoke_unified_counter`) and T17 (`timebox_and_invoke_counter_accounting`) are Tier 1 and load-bearing.** They are the primary conformance evidence for the allocator model (spec §6). A namespaced-allocator implementation would observably fail these tests. Demoting them to Tier 2 would eliminate the ability to detect the most consequential design regression.
- **T19 (`fn_identity_stability_gate`) is Tier 2.** It reinforces an assumption the nested-invocation spec relies on (invariant I-ID survives compiler builds) but does not itself specify. The content-hash-stability requirement is a compiler-spec concern; promotion depends on that spec carrying the requirement normatively.
- **Remote execution is not covered as conformance.** §14 of the nested-invocation spec is non-normative. This plan contains no tests that assert conformance to remote-execution behaviors. The three invariants N-RA1–N-RA3 named in spec §14 are already validated by Tier 1 tests covering their normative origins: N-RA1 by T15/T17 (parent-authoritative allocation); N-RA2 by T01/T11 (parent-authoritative journal); N-RA3 by T02/T10/T13 (parent-authoritative replay).

---

## 9. Explicit out-of-scope coverage

This plan does not claim coverage for:

- **Subordinate remote execution.** §14 of the nested-invocation spec is a non-normative forward-compatibility note. No test in this plan exercises remote execution behavior.
- **Wire protocol, network failure semantics, transport format, partition/retry behavior.** Out of scope per spec §14.
- **Concurrent `ctx.invoke` composition within a single invoking middleware body.** Deferred per spec §15.
- **Per-invocation narrower timebox applied to the invoked child.** Deferred per spec §15.
- **Per-invocation agent rebinding.** Deferred per spec §15.
- **Detached-lifetime nested invocation.** Out of scope per spec §15; `spawn` at the workflow layer is the correct mechanism.
- **Any kernel-visible descriptor form of nested invocation.** Explicitly rejected per spec §15; no test exercises a descriptor path.
- **Any namespaced or `.n`-prefixed child-ID format.** Explicitly rejected per spec §6.6; T15 and T17 include explicit assertions against this pattern.

Adding coverage for any of the above requires a corresponding spec amendment first.
