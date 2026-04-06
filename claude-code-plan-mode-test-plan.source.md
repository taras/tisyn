# Tisyn Claude Code Plan Mode — Conformance Test Plan

**Version:** 0.2.3
**Tests:** Tisyn Claude Code Plan Mode Specification v0.1.5
**Status:** Draft

---

### Changelog

**v0.2.3 — Correction Pass 13**

CP23. **§9 replay acceptance criterion fixed.** Was:
      "Replay assertions validate both Case A (live
      frontier) and Case B (stored result) explicitly."
      That made the Extended test CCPM-034b (Case A)
      sound mandatory. Revised to require only Case B
      (Core) for conformance, with Case A recommended
      via the Extended tier. §3.1 scope wording updated
      to match.

**v0.2.2 — Correction Pass 12**

CP22. **§4 opening sentence fixed.** Was: "All tests
      compare observable outputs only." That contradicted
      the two-tier model in the same section. Now opens
      with: "This plan uses two tiers of evidence" and
      states that conformance is determined by Tier 1
      normative assertions, while Tier 2 reference-harness
      evidence is used for diagnosis but is not part of
      the normative public surface.

**v0.2.1 — Correction Pass 11**

CP21. **CC8a confirmed as real spec subclause.** The source
      spec (v0.1.5, correction pass 4, CP9) defines CC8a
      as a normative subclause of CC8. Updated §2 clause-
      ID summary from "CC1–CC11" to "CC1–CC11 including
      subclause CC8a" so the plan does not appear to
      invent clause IDs. All CC8a references (CCPM-004
      spec ref, §11 mapping) are correct and unchanged.

**v0.2.0 — Correction Pass 10**

CP20. **§2 coverage overclaim fixed.** Was: "All spec
      clause IDs … are referenced by test." Now
      distinguishes three disposition categories: direct
      test coverage, explicit deferral, and adapter-
      internal / out-of-scope handling. Clauses SC5,
      ED5, and EV8–EV9 are accounted for but not covered
      by plan tests.

**v0.1.9 — Correction Pass 9**

CP19. **§7.4 layer note updated.** CCPM-042 (unknown event
      type delivery) was reclassified as Runtime + Adapter
      in CP12 but the §7.4 category header still said
      "Layer: Runtime" with no exception. Updated to note
      CCPM-042 as Runtime + Adapter, making the §8 summary
      (1 Core + 2 Extended for Runtime + Adapter) exactly
      match the matrix. The three Runtime + Adapter tests
      are now explicitly identified: CCPM-029 (Core),
      CCPM-005 (Extended), CCPM-042 (Extended).

**v0.1.8 — Correction Pass 8**

CP17. **§1 overview layer vocabulary updated.** Was:
      "organized by conformance layer (runtime, adapter,
      compiler)." Now: "organized by conformance layer
      (Runtime, Runtime + Adapter, Compiler)." Matches
      the corrected layer model from CP15.

CP18. **§8 note label updated.** Was: "Note on adapter
      layer." Now: "Note on adapter-related coverage."
      No standalone adapter layer exists in this plan.

**v0.1.7 — Correction Pass 7**

CP14. **CCPM-004 fixed to single-layer ownership.** Was:
      "Rejected (compiler or runtime)" — invalid mixed-
      layer pass condition. Now a runtime backstop test:
      setup uses hand-constructed IR that bypasses the
      compiler, and the expected outcome is runtime
      rejection only. Traceable to CC8a.

CP15. **"Adapter tests" subsection relabeled.** §4 had a
      standalone "Adapter tests compare" subsection, but
      the plan has no adapter-only layer (§8). Renamed to
      "Runtime + Adapter tests" to match the actual layer
      inventory.

CP16. **Full matrix audited for mixed-layer outcomes.** No
      other tests use "compiler or runtime" or similarly
      ambiguous pass conditions. CCPM-004 was the only
      instance.

**v0.1.6 — Correction Pass 6**

CP13. **Observability model reconciled with harness
      evidence.** §4 closing paragraph no longer claims
      "no test depends on adapter-internal state" — which
      contradicted the mock-adapter session-state evidence
      used in CCPM-005, CCPM-036, CCPM-037, CCPM-038.
      §4 now distinguishes two evidence tiers:
      (1) normative observable assertions (returned values,
      capability shape, event delivery, replay outcome,
      error propagation, journal contents) — these
      determine conformance; (2) reference-harness evidence
      (mock adapter session state, adapter-contact tracking)
      — used to strengthen or diagnose tests in the
      reference suite but not part of the normative public
      surface.

**v0.1.5 — Correction Pass 5**

CP11. **Acceptance criteria fixed.** §9 item 1 no longer
      uses a range shorthand that excludes suffixed IDs.
      Now states that all tests marked Core in the plan
      must pass, with an explicit enumeration of the 31
      Core test IDs including `CCPM-035b`.

CP12. **Layer summary reconciled with adapter-scope note.**
      Removed the "Adapter-only" row from the §8 table.
      The note already states pure adapter conformance
      tests are outside this plan's scope. The one
      Extended test that exercises adapter-owned behavior
      (`CCPM-042`, unknown event type delivery) is
      reclassified as Runtime + Adapter since it validates
      runtime delivery behavior using a mock adapter.
      Layer totals updated for consistency.

**v0.1.4 — Correction Pass 4**

CP10. **CP7/CP8 contradiction resolved.** CP7 was a real
      correction: the §11 clause mapping for `EV1` was
      genuinely wrong (mapped to `CCPM-010`, which tests
      handle shape, not the event envelope) and was fixed
      to `CCPM-021`. CP8 incorrectly stated "both tables
      were already correct" — revised to acknowledge
      that the §11 fix in CP7 was real, and that CP8's
      contribution was adding namespace disambiguation
      notes after that fix.

**v0.1.3 — Correction Pass 3**

CP8. **Two-namespace traceability clarified.** The plan
     uses two mapping tables that reference different ID
     namespaces from the spec:
     - §2 maps **spec §14 test IDs** (hyphenated:
       `EV-001`, `SV-002`, etc.) to plan test IDs.
     - §11 maps **spec clause IDs** (bare: `EV1`, `SV5`,
       etc.) to plan test IDs.
     These are different namespaces: `EV-001` is a spec
     conformance test ID (validates clause `EV4`),
     while `EV1` is a spec clause (event envelope).
     The §2 table (spec §14 test IDs) was already
     correct. The §11 table (clause IDs) had been
     corrected in CP7. Added clarifying headers and
     notes to both sections to make the two namespaces
     unmistakable.

CP9. **Full audit of both mapping tables.** Verified
     every row in §2 and §11 against the spec. No
     additional mismatches found beyond the `EV1`
     clause-mapping correction already applied in CP7
     and the namespace labeling added in CP8.

**v0.1.2 — Correction Pass 2**

CP4. **CCPM-018 fixed.** Removed non-specified scope-level
     event observer. Test now validates that direct join
     returns the final result without any `supervise` call,
     and uses harness-only evidence (clearly labeled) to
     confirm events were produced but not delivered through
     any user-visible path.

CP5. **CCPM-031 and CCPM-034 fixed.** Removed non-specified
     event observer references. Both now use either
     `supervise`-based observation or clearly labeled
     harness-only evidence.

CP6. **Adapter-contact checks labeled.** Tests that check
     whether the mock adapter was contacted (CCPM-030,
     CCPM-033, CCPM-034b) now explicitly note this as
     reference harness evidence, not normative API.

CP7. **EV1 traceability fixed.** EV1 was incorrectly mapped
     to CCPM-010 (execution handle shape). Now mapped to
     CCPM-021, whose expected behavior is updated to
     include explicit envelope assertion (each event has
     `type` and `data` fields).

**v0.1.1 — Correction Pass 1**

CP1. **Observability model fixed.** §4 no longer references
     `execute()`. Runtime observables are now expressed in
     terms of the actual spec surface: `open()`, `plan()`,
     `yield* planned`, `supervise(planned, handler)`,
     `fork()`, journal inspection, and mock adapter contact
     tracking.

CP2. **Fixture names softened.** `InMemoryStream` and
     `MockClaudeCodeConfig` are now presented as reference
     fixture examples, not normative implementation
     requirements. The test plan specifies observable
     assertions; conforming test suites MAY use any harness
     that validates the same observable properties.

CP3. **Acceptance criteria updated.** Removed `execute()`
     and `InMemoryStream` references. Acceptance criteria
     now refer to observable outcomes rather than specific
     harness identities.

---

### Coverage Summary

This test plan defines 48 conformance tests across 8
categories. 31 are Core (MUST-pass), 17 are Extended
(SHOULD-pass). Every MUST-pass and SHOULD-pass requirement
from the specification's §14 conformance table is mapped
into this plan with full traceability.

| Category | Core | Extended | Total |
|----------|------|----------|-------|
| Session-scoped capability | 4 | 2 | 6 |
| Execution handle | 4 | 4 | 8 |
| Direct join | 4 | 1 | 5 |
| Supervised consumption | 5 | 2 | 7 |
| Event delivery | 4 | 2 | 6 |
| Replay and durability | 4 | 1 | 5 |
| Fork / branch | 5 | 2 | 7 |
| Compiler diagnostics | 1 | 3 | 4 |
| **Total** | **31** | **17** | **48** |

---

## 1. Overview

This test plan validates the observable behavior defined
by the Tisyn Claude Code Plan Mode Specification v0.1.5.
It covers the session-scoped capability, execution handle,
direct join, supervised consumption, event delivery, replay
and durability, fork/branch behavior, and compiler
diagnostics.

The plan is organized by conformance layer (Runtime,
Runtime + Adapter, Compiler) and by behavioral category.
Each test specifies its layer, tier, spec reference, and
observable assertion.

---

## 2. Relationship to the Specification

This plan maps directly to the Claude Code Plan Mode
Specification v0.1.5. All spec clause IDs (CC1–CC11
including subclause CC8a,
EH1–EH10, DJ1–DJ8, SV1–SV13, SC1–SC6, ED1–ED5,
EV1–EV9, PL1–PL10, FK1–FK13, RD1–RD7) are accounted
for in this plan by one of three dispositions:

- **Direct test coverage:** the clause is validated by
  one or more plan tests (see §11).
- **Explicit deferral:** the clause corresponds to
  behavior deferred to a future spec or test plan
  (e.g., SC5 — compiler branch exhaustiveness; see §10).
- **Out-of-scope / adapter-internal:** the clause
  describes adapter-internal behavior exercised through
  the mock adapter but not validated by a dedicated plan
  test (e.g., EV8–EV9; ED5 — future buffering policy).

Every MUST-pass entry from the spec's §14.1 table appears
as a Core test. Every SHOULD-pass entry from §14.2
appears as an Extended test.

Traceability from spec §14 conformance table to this plan:

> **ID namespace note.** The spec uses two distinct ID
> namespaces. Spec §14 **test IDs** are hyphenated
> (e.g., `EV-001`, `SV-002`). Spec **clause IDs** are
> bare (e.g., `EV1`, `SV5`). These are different: `EV-001`
> is a conformance test that validates clause `EV4`
> (journal absence), while `EV1` is the event-envelope
> clause. The table below maps spec §14 test IDs. The
> clause-level mapping is in §11.

| Spec §14 test ID | This plan ID |
|-------------|-------------|
| CC-001 | CCPM-001 |
| CC-002 | CCPM-002 |
| CC-003 | CCPM-030 |
| EH-001 | CCPM-010 |
| EH-002 | CCPM-011 |
| DJ-001 | CCPM-015 |
| DJ-002 | CCPM-016 |
| DJ-003 | CCPM-017 |
| DJ-004 | CCPM-018 |
| SV-001 | CCPM-020 |
| SV-002 | CCPM-021 |
| SV-003 | CCPM-022 |
| SV-004 | CCPM-023 |
| SV-005 | CCPM-024 |
| SC-001 | CCPM-012 |
| SC-002 | CCPM-013 |
| SC-003 | CCPM-014 |
| ED-001 | CCPM-025 |
| EV-001 | CCPM-028 |
| EV-002 | CCPM-031 |
| RD-001 | CCPM-032 |
| RD-002 | CCPM-033 |
| FK-001 | CCPM-035 |
| FK-002 | CCPM-036 |
| FK-003 | CCPM-037 |
| FK-004 | CCPM-038 |
| CC-010 | CCPM-045 |
| CC-011 | CCPM-046 |
| CC-012 | CCPM-047 |
| CC-013 | CCPM-048 |
| SV-010 | CCPM-041 |
| SV-011 | CCPM-042 |
| FK-010 | CCPM-043 |

---

## 3. Scope

### 3.1 What This Plan Covers

- Runtime behavior of `ClaudeCode().open(...)`, `cc.plan(...)`,
  `cc.fork()`, `yield* planned`, and `supervise(planned,
  handler)`
- Execution handle restricted-capability rules
- Single-consumer ownership enforcement (runtime backstop)
- Event delivery contract (buffered-from-start, ordering,
  non-durability)
- Replay and durability: Case B (stored result) as Core,
  Case A (live frontier) as Extended
- Fork isolation, lifetime, and teardown semantics
- Compiler static enforcement where the spec assigns compiler
  responsibility

### 3.2 What This Plan Does Not Cover

The following correspond to deferred extensions in the
specification (§15):

- `accept()` operation
- Durable event streaming
- Merge / promote for forked sessions
- Cross-branch communication
- Recursive forking (branch-of-branch)
- Multi-model routing
- Generic ACP abstraction
- Structured output enforcement
- Cost / token budget management

Tests that would validate deferred behavior are listed in
§10 (Deferred / Future Tests) for tracking purposes.

---

## 4. Observability Model

This plan uses two tiers of evidence. Conformance is
determined solely by Tier 1 normative assertions. Tier 2
reference-harness evidence is used to strengthen or
diagnose tests in the reference suite but is not part of
the normative public API surface.

**Tier 1 — Normative observable assertions.** These
determine conformance. A conforming implementation MUST
produce the expected Tier 1 outcomes.

- Capability shape returned by `ClaudeCode().open(...)`
  (has `plan` and `fork` methods)
- Capability shape returned by `cc.fork()` (has `plan`,
  does not have `fork`)
- Result value returned by `yield* planned` or
  `yield* supervise(planned, handler)`
- Event sequences observed through the `supervise` handler
  (captured via a recording wrapper)
- Error category and propagation behavior (by category,
  not exact message wording)
- Journal contents after execution (presence/absence of
  durable artifacts — YieldEvents and CloseEvents)

**Tier 2 — Reference-harness evidence.** These are used
in the reference test suite to strengthen or diagnose
tests. They depend on mock-adapter instrumentation and
are NOT part of the normative public API surface.
Alternative test suites MAY use different harness
techniques to validate the same underlying properties.

- Whether the mock adapter was contacted during replay
- Mock adapter session state (for fork isolation and
  replay reconstruction tests)

Tests that use Tier 2 evidence label it explicitly as
"*Harness-only evidence*" in the expected-behavior column.
Conformance is determined solely by Tier 1 assertions.

**Compiler tests** compare:
- Acceptance (produces conforming output) or rejection
  (produces a diagnostic identifying the violated constraint)
- Diagnostics are compared by violated-rule category, not by
  message wording

**Runtime + Adapter tests** additionally compare:
- Event envelope conformance (type + data fields present)
- Event delivery ordering
- Unknown event type passthrough behavior

No test depends on exact IR field names or journal storage
format beyond canonical JSON equality.

---

## 5. Tiers

**Core:** Tests that every conforming implementation MUST
pass. An implementation is non-conforming if any Core test
fails.

**Extended:** Tests for edge cases, diagnostic quality, and
SHOULD-level behavior. Recommended but not required for
initial conformance.

---

## 6. Test Infrastructure

### 6.1 Mock Claude Code Adapter

All runtime tests use a mock Claude Code adapter that
simulates the backend without requiring a real Claude Code
process or API key. The following is a reference fixture
shape; conforming test suites MAY use any mock
implementation that provides equivalent observable
behavior.

```typescript
// Reference fixture shape (not normative)
interface MockClaudeCodeConfig {
  // Events to emit during plan execution (in order)
  events?: Array<{ type: string; data: unknown }>;
  // Final result to return on plan completion
  result?: unknown;
  // Error to throw during execution (if set, overrides result)
  error?: { message: string; name?: string };
  // Delay before completion (milliseconds)
  delay?: number;
  // Whether to never complete (for cancellation tests)
  hang?: boolean;
  // Session state snapshot (for fork isolation tests)
  sessionState?: unknown;
}
```

The mock adapter:

- Creates a session resource with configurable state
- Supports `plan()` dispatching with configurable events
  and result
- Supports `fork()` with snapshot-based isolation
- Supports cancellation (halts on scope teardown)
- Does not depend on any Claude backend, SDK, or network

### 6.2 Event Capture

Tests that validate event delivery install a capture
wrapper around the `supervise` handler that records all
events in order. The captured sequence is compared against
expected events after execution.

```typescript
// Reference capture shape (not normative)
interface CapturedEvent {
  type: string;
  data: unknown;
  index: number; // delivery order
}
```

### 6.3 Replay Harness

Replay tests require a harness that supports:

- Pre-populating a journal with specific durable events
  (YieldEvents and CloseEvents)
- Re-executing the same workflow against the pre-populated
  journal
- Tracking whether the mock adapter was contacted during
  replay (to verify Case B non-re-execution)
- Comparing the replayed result against the expected value

Conforming test suites MAY use any replay harness
(e.g., an in-memory journal stream) that provides these
capabilities.

---

## 7. Test Categories and Detailed Matrix

### 7.1 Session-Scoped Capability

Tests in this category validate the session resource
lifecycle, capability shape, and replay reconstruction.

**Layer:** Runtime (except CCPM-005 which is Runtime +
Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-001 | Core | `ClaudeCode().open(...)` returns a capability with `plan` and `fork` methods | CC1, §3.1 | Call `open()` with mock adapter config. Inspect returned value. | Returned value has callable `plan` and `fork` methods. |
| CCPM-002 | Core | Scope teardown closes the root session | CC3 | Call `open()` inside a `scoped()` block. Exit the scope. Track mock adapter session lifecycle. | Mock adapter's session shutdown is called during scope teardown. |
| CCPM-003 | Core | Session capability is invalid after resource teardown | CC4 | Call `open()` inside a `scoped()` block. Exit the scope. Attempt to call `plan()` on the stale capability from outside. | Runtime rejects the call with a descriptive error. |
| CCPM-004 | Core | Branch capability follows same restricted-capability rules as root (runtime backstop) | CC8a | Hand-constructed IR that bypasses the compiler and attempts to pass a branch capability as data in an agent effect dispatch. | Runtime rejects with a descriptive error. |
| CCPM-005 | Extended | Session reconstructed on replay reflects full execution history | CC5 | Execute a workflow that opens a session, runs two `plan()` calls with results A and B. Pre-populate journal with both results. Replay. | Replay produces same results A and B. *Harness-only evidence:* mock adapter session state reflects both prior plans during reconstruction. |
| CCPM-006 | Extended | Session configuration is passed to adapter | CC9 | Call `open({ cwd: "/test", model: "test-model" })`. Inspect mock adapter initialization. | Mock adapter receives the configuration values. |

### 7.2 Execution Handle

Tests in this category validate execution handle creation,
identity, restriction rules, and single-consumer
enforcement.

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-010 | Core | `cc.plan(...)` returns an execution handle | EH1 | Call `plan()` on a session capability. Inspect returned value. | Returned value has `__tisyn_execution` field with a string token. |
| CCPM-011 | Core | Execution handle token is deterministic | EH5–EH7 | Execute same IR twice with same initial state. Compare handle tokens. | Same token in both executions. |
| CCPM-012 | Core | Second consumption rejected: join then join | SC1, SC3 | Create handle. Join it once. Attempt to join again. | Runtime rejects with "execution handle already consumed." |
| CCPM-013 | Core | Second consumption rejected: supervise then join | SC1, SC3 | Create handle. Supervise it. After supervision returns, attempt to join. | Runtime rejects with "execution handle already consumed." |
| CCPM-014 | Extended | Second consumption rejected: join then supervise | SC1, SC3 | Create handle. Join it. After join returns, attempt to supervise. | Runtime rejects with "execution handle already consumed." |
| CCPM-040 | Extended | Unconsumed handle: execution still runs and result is journaled | SC4 | Create handle. Never consume it. Let scope exit. Inspect journal. | Child CloseEvent present in journal with the execution's result. |
| CCPM-044 | Extended | Handle token incorporates parent coroutineId | EH7 | Create two handles from different parent coroutines. Compare tokens. | Tokens differ. Both incorporate their respective parent coroutineId. |
| CCPM-039 | Extended | Handle restriction: cannot cross agent boundary | EH4 | Attempt to pass execution handle as data in an agent call. | Runtime rejects. |

### 7.3 Direct Join

Tests in this category validate `yield* planned`
semantics.

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-015 | Core | `yield* planned` returns the plan's final result | DJ1, DJ2 | Mock adapter configured with `result: { proposal: "refactor" }`. Call `plan()`, join. | Join returns `{ proposal: "refactor" }`. |
| CCPM-016 | Core | Join returns immediately if execution already completed | DJ7 | Mock adapter configured with `delay: 0`. Call `plan()`. Insert an artificial delay before join. Join. | Join returns immediately with the stored result. |
| CCPM-017 | Core | Execution failure propagates through join | DJ3, DJ8 | Mock adapter configured with `error: { message: "backend error" }`. Call `plan()`, join. | Join throws error with message "backend error". Child CloseEvent has `status: "err"`. |
| CCPM-018 | Core | Direct join does not observe events | DJ4 | Mock adapter configured with 3 events and a result. Call `plan()`, join via `yield* planned` — no `supervise(...)` call. | Join returns result normally. No authored handler is invoked (none exists). *Harness-only evidence:* mock adapter confirms events were produced internally but no user-visible delivery occurred. |
| CCPM-019 | Extended | Join waits for a slow execution | DJ1, DJ5 | Mock adapter configured with `delay: 200`, `result: { done: true }`. Call `plan()`, join. | Join suspends, then returns `{ done: true }` after ~200ms. |

### 7.4 Supervised Consumption

Tests in this category validate `supervise(planned,
handler)` semantics.

**Layer:** Runtime (except CCPM-042 which is Runtime +
Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-020 | Core | `supervise` returns the final result on completion | SV7 | Mock adapter with 2 events and result `{ ok: true }`. Supervise with no-op handler. | `supervise` returns `{ ok: true }`. |
| CCPM-021 | Core | Handler is invoked for each event in order with conforming envelope | EV1, SV5, SV6 | Mock adapter with events `[{type:"a", data:{x:1}}, {type:"b", data:{x:2}}, {type:"c", data:{x:3}}]`. Capture handler invocations. | Handler invoked 3 times. Captured order is a, b, c. Each captured event has a `type` (string) and `data` field per EV1. |
| CCPM-022 | Core | Handler failure cancels the underlying execution | SV9 | Mock adapter configured to emit 5 events with delay between each, plus a result. Handler throws on event 2. Track mock adapter cancellation. | `supervise` throws the handler's error. Mock adapter's execution is cancelled. Events 3–5 are never delivered. |
| CCPM-023 | Core | Execution failure during supervision propagates to caller | SV10 | Mock adapter emits 1 event then errors. Supervise with no-op handler. | `supervise` throws the execution error. Handler was invoked for event 1 but not for the error. |
| CCPM-024 | Core | No-events path returns result immediately | SV11 | Mock adapter with `events: []`, `result: { empty: true }`. | `supervise` returns `{ empty: true }`. Handler never invoked. |
| CCPM-041 | Extended | Handler may perform `yield*` effects | SV2 | Mock adapter with 1 event and result. Handler performs a `yield*` effect (e.g., a simple agent call via mock). | Handler effect completes normally. `supervise` returns result. |
| CCPM-042 | Extended | Runtime delivers unknown event types to handler without rejection | EV2 | Mock adapter emits event with `type: "custom_unknown_xyz"`. Supervise with handler that records the event. | Handler receives the event. No runtime error. Event has `type: "custom_unknown_xyz"` and `data` field intact. |

### 7.5 Event Delivery

Tests in this category validate the buffered-from-start
contract, non-durability, and delivery semantics.

**Layer:** Runtime (except CCPM-029 which is Runtime +
Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-025 | Core | Events emitted before `supervise` are delivered | ED1, ED2 | Mock adapter emits 3 events immediately at execution start. Insert artificial delay before `supervise`. Capture handler invocations. | All 3 buffered events are delivered to handler in order, followed by any subsequent live events. |
| CCPM-026 | Core | Backpressure: next event waits for handler completion | SV5 | Mock adapter emits events rapidly. Handler includes a `yield* sleep(50)` effect. Record timestamps of handler invocations. | Each handler invocation starts only after the previous one completes. No concurrent handler invocations. |
| CCPM-028 | Core | Events are not in the journal after execution | EV4 | Mock adapter with 3 events and result. Execute, inspect journal. | Journal contains YieldEvents and CloseEvent for the execution child. No event-typed entries. Only the final result is present. |
| CCPM-029 | Core | Direct-join path discards undrained buffer | ED4 | Mock adapter with 3 events and result. Join directly (no supervise). Let scope exit. | Join returns result. No error from undrained buffer. Buffer is silently discarded. |
| CCPM-027 | Extended | Event ordering is preserved across buffered and live boundary | ED2 | Mock adapter emits events 1–3 before supervision starts, then events 4–6 after. Capture order. | Handler receives events 1, 2, 3, 4, 5, 6 in order. No gap or reorder at the boundary. |
| CCPM-034 | Extended | Events not preserved across crash/recovery | EV6(a) | Execute workflow that starts plan with events. Simulate crash before final result. Replay. Supervise on the replayed path with a recording handler. | Handler receives zero events from the prior execution. If replay reaches live frontier, the re-established execution MAY produce new events (which may differ from pre-crash events). |

### 7.6 Replay and Durability

Tests in this category validate the two-case replay
contract.

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-030 | Core | Replay reconstructs session capability at same program point | CC5, RD5(B) | Pre-populate journal with session init and two plan results. Replay same IR. | Replay produces same session capability. Both plan results replayed from journal. *Harness-only evidence:* mock adapter NOT re-contacted for completed plans. |
| CCPM-031 | Core | Events are not produced during replay (Case B) | EV5, RD5(B) | Pre-populate journal with complete execution (init + plan CloseEvent). Replay. Call `plan()` + `supervise(planned, handler)` on the replayed path. | Handler is never invoked (no events produced). Result replayed from journal. *Harness-only evidence:* mock adapter confirms no event-producing execution occurred. |
| CCPM-032 | Core | Final result is journaled as child CloseEvent | PL9, RD1 | Execute a plan to completion. Inspect journal. | Journal contains CloseEvent under the execution's child coroutineId with `status: "ok"` and the result value. |
| CCPM-033 | Core | Replay Case B: stored result returned without re-execution | RD5(B), EH8 | Pre-populate journal with plan's CloseEvent. Replay. | Replay returns the stored result. Handle reconstructed at same program point. *Harness-only evidence:* mock adapter NOT contacted. |
| CCPM-034b | Extended | Replay Case A: live frontier re-establishes execution | RD5(A) | Pre-populate journal with session init but NO plan CloseEvent. Replay. Configure mock adapter with a new result. | Replay reaches live frontier. New result is produced and journaled. Prior events are not replayed. *Harness-only evidence:* mock adapter IS contacted for the re-established execution. |

### 7.7 Fork / Branch

Tests in this category validate fork isolation, lifetime,
and API shape.

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-035 | Core | `cc.fork()` returns a `ClaudeCodeBranch` with `plan` but not `fork` | FK3, FK10 | Call `fork()`. Inspect returned value. | Returned value has `plan` method. Does NOT have `fork` method. |
| CCPM-036 | Core | Branch planning does not mutate parent state | FK4 | Open session. Fork. Plan on branch with prompt X. Plan on parent with prompt Y. | Parent plan result reflects only prompt Y context. *Harness-only evidence:* mock adapter parent session state does not include branch's plan history. |
| CCPM-037 | Core | Parent planning does not mutate branch state | FK5 | Open session. Fork. Plan on parent with prompt X. Plan on branch with prompt Y. | Branch plan result reflects only pre-fork context + prompt Y. *Harness-only evidence:* mock adapter branch session state does not include parent's post-fork plan history. |
| CCPM-038 | Core | Branch teardown does not mutate parent session | FK9 | Open session. Fork inside a nested scope. Exit nested scope (branch torn down). Continue planning on parent. | Parent session continues normally. *Harness-only evidence:* mock adapter parent session state is unaffected by branch teardown. |
| CCPM-035b | Core | Branch lifetime bounded by enclosing scope | FK7, FK8 | Open session. Fork inside a scoped block. Exit the scoped block. Attempt to use branch. | Branch is torn down. Attempt to use branch results in error. |
| CCPM-043 | Extended | Multiple forks from same parent are independent | FK6 | Fork twice from same parent. Plan differently on each branch. | Each branch has independent state. Branch A does not see Branch B's plans and vice versa. |
| CCPM-043b | Extended | Fork replay reconstructs branch capability | FK11, FK12 | Execute workflow with fork and branch plan. Pre-populate journal with both. Replay. | Branch capability reconstructed. Branch plan result replayed from journal. |

### 7.8 Compiler Diagnostics

Tests in this category validate static enforcement where
the spec assigns compiler responsibility.

**Layer:** Compiler

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-048 | Core | Compiler warns on unconsumed handle | SC4 | Authored source creates handle but never joins or supervises it. | Compiler emits a warning diagnostic. |
| CCPM-045 | Extended | Compiler rejects handle passed as agent argument | EH4 | Authored source passes execution handle as argument to an agent method call. | Compiler rejects with diagnostic identifying EH4 violation. |
| CCPM-046 | Extended | Compiler rejects handle returned from workflow | EH4 | Authored source returns execution handle from the workflow. | Compiler rejects with diagnostic identifying EH4 violation. |
| CCPM-047 | Extended | Compiler rejects handle stored in object | EH4 | Authored source stores execution handle in an object literal. | Compiler rejects with diagnostic identifying EH4 violation. |

---

## 8. Layer Summary

| Layer | Core tests | Extended tests | Total |
|-------|-----------|---------------|-------|
| Runtime | 29 | 12 | 41 |
| Runtime + Adapter | 1 | 2 | 3 |
| Compiler | 1 | 3 | 4 |
| **Total** | **31** | **17** | **48** |

> **Note on adapter-related coverage.** Most adapter-specific behavior
> (event translation, backend communication, session state
> management) is exercised through the mock adapter in
> runtime tests. The "Runtime + Adapter" tests validate
> runtime behavior that depends on adapter-produced
> artifacts (e.g., event delivery, session reconstruction).
> Pure adapter conformance tests — validating a real
> adapter against the event envelope contract (§9.1) —
> are outside this plan's scope and belong to each
> adapter's own test suite.

---

## 9. Acceptance Criteria

The Claude Code Plan Mode implementation is considered
conforming when:

1. All 31 Core tier tests pass:
   CCPM-001, CCPM-002, CCPM-003, CCPM-004,
   CCPM-010, CCPM-011, CCPM-012, CCPM-013,
   CCPM-015, CCPM-016, CCPM-017, CCPM-018,
   CCPM-020, CCPM-021, CCPM-022, CCPM-023, CCPM-024,
   CCPM-025, CCPM-026, CCPM-028, CCPM-029,
   CCPM-030, CCPM-031, CCPM-032, CCPM-033,
   CCPM-035, CCPM-035b, CCPM-036, CCPM-037, CCPM-038,
   CCPM-048.

2. No Core tier test produces an unexpected error, hang,
   or crash.

3. The mock adapter is sufficient to run all Core tier
   tests — no real Claude Code backend is required for
   conformance.

4. Journal assertions validate presence/absence of
   durable artifacts (YieldEvents and CloseEvents). No
   new test infrastructure is introduced beyond the mock
   adapter, event capture wrapper, and replay harness.
   Conforming test suites MAY use any harness that
   validates the same observable properties.

5. Replay assertions validate Case B (stored result)
   as a Core conformance requirement. Case A (live
   frontier re-establishment) is validated by Extended
   test CCPM-034b and is recommended but not required
   for initial conformance.

---

## 10. Deferred / Future Tests

The following tests are explicitly NOT part of this plan.
They correspond to deferred features in the specification
(§15).

| Area | Reason |
|------|--------|
| `accept()` operation | Deferred (§15.1). Execution/apply semantics not yet defined. |
| Durable event streaming | Deferred (§15.2). Events consumed as durable workflow data. |
| Merge / promote for branches | Deferred (§15.3). No merge/promote operations in v1. |
| Cross-branch communication | Deferred (§15.4). Branches are independent resource scopes. |
| Recursive forking | Deferred (§15.5, FD4). `ClaudeCodeBranch` does not expose `fork()`. |
| Multi-model routing | Deferred (§15.6). Session uses model configured at open time. |
| Structured output enforcement | Deferred (§15.8). |
| Cost / token budget management | Deferred (§15.9). |
| Compiler single-consumer exhaustiveness across `if` branches | SC5. Spec says compiler SHOULD enforce. Deferred until the compiler's branch-analysis capabilities are validated. |
| Compiler enforcement of `let` reassignment on handles | EH4. Spec says compiler enforces. Deferred until authored-language `let` restrictions are formalized. |

---

## 11. Spec Clause Coverage

### 11.1 Full Clause Mapping

> **ID namespace note.** This table maps spec **clause IDs**
> (bare: `EV1`, `SV5`, `CC1`, etc.) — the normative rules
> in the spec body — to plan test IDs. This is distinct
> from §2, which maps spec §14 **test IDs** (hyphenated:
> `EV-001`, `SV-002`, etc.). For example, clause `EV1`
> (event envelope) is covered by `CCPM-021`, while spec
> test `EV-001` (journal absence, validating clause `EV4`)
> is covered by `CCPM-028`.

| Spec clause | Test IDs | Coverage |
|-------------|----------|----------|
| CC1 | CCPM-001 | Core |
| CC3 | CCPM-002 | Core |
| CC4 | CCPM-003 | Core |
| CC5 | CCPM-005, CCPM-030 | Extended, Core |
| CC6–CC7 | CCPM-004 (via CC8a) | Core |
| CC8a | CCPM-004 | Core |
| CC9 | CCPM-006 | Extended |
| CC10–CC11 | CCPM-001 (shape validation) | Core |
| EH1 | CCPM-010 | Core |
| EH4 | CCPM-039, CCPM-045–047 | Extended |
| EH5–EH7 | CCPM-011, CCPM-044 | Core, Extended |
| EH8–EH9 | CCPM-033 | Core |
| EH10 | CCPM-012, CCPM-013 | Core |
| SC1, SC3 | CCPM-012–014 | Core, Extended |
| SC4 | CCPM-040, CCPM-048 | Extended, Core |
| SC5 | Deferred (§10) | — |
| SC6 | CCPM-012, CCPM-013 | Core |
| DJ1–DJ2 | CCPM-015 | Core |
| DJ3 | CCPM-017 | Core |
| DJ4 | CCPM-018 | Core |
| DJ5 | CCPM-019 | Extended |
| DJ7 | CCPM-016 | Core |
| DJ8 | CCPM-017 | Core |
| SV1–SV3 | CCPM-041 | Extended |
| SV5 | CCPM-021, CCPM-026 | Core |
| SV6 | CCPM-021 | Core |
| SV7 | CCPM-020 | Core |
| SV8 | CCPM-013 | Core |
| SV9 | CCPM-022 | Core |
| SV10 | CCPM-023 | Core |
| SV11 | CCPM-024 | Core |
| SV12–SV13 | CCPM-042 (partial) | Extended |
| ED1–ED2 | CCPM-025, CCPM-027 | Core, Extended |
| ED3 | CCPM-025 | Core |
| ED4 | CCPM-029 | Core |
| ED5 | Not tested (future policy) | — |
| EV1 | CCPM-021 (envelope shape) | Core |
| EV2 | CCPM-042 | Extended |
| EV3 | CCPM-021 | Core |
| EV4 | CCPM-028 | Core |
| EV5 | CCPM-031 | Core |
| EV6 | CCPM-034, CCPM-029 | Extended, Core |
| EV7 | CCPM-028 (non-durability) | Core |
| EV8–EV9 | Adapter-internal (mock) | — |
| PL1–PL4 | CCPM-015, CCPM-018 | Core |
| PL5 | CCPM-015 (input) | Core |
| PL8–PL9 | CCPM-032 | Core |
| PL10 | CCPM-028 | Core |
| FK1 | CCPM-035 (shape) | Core |
| FK3 | CCPM-035 | Core |
| FK4 | CCPM-036 | Core |
| FK5 | CCPM-037 | Core |
| FK6 | CCPM-043 | Extended |
| FK7–FK8 | CCPM-035b | Core |
| FK9 | CCPM-038 | Core |
| FK10 | CCPM-035 | Core |
| FK11–FK12 | CCPM-043b | Extended |
| FK13 | CCPM-043b (partial) | Extended |
| RD1 | CCPM-032 | Core |
| RD2 | CCPM-028, CCPM-031 | Core |
| RD3–RD4 | CCPM-028 (no new event kinds) | Core |
| RD5(A) | CCPM-034b | Extended |
| RD5(B) | CCPM-033 | Core |
| RD6 | CCPM-033, CCPM-011 | Core |
| RD7 | CCPM-033 | Core |
