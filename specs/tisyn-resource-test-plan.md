# Tisyn Resource — Conformance Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Resource Specification 0.1.0
**Status:** Draft

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the resource
scope-creation MVP as specified in the Tisyn Resource
Specification v0.1.0 (Draft). It covers:

- compiler acceptance and rejection of authored `resource(...)`
  and `provide(...)` forms per §3
- IR lowering of `resource(...)` and `provide(...)` per §4
  and §9
- kernel evaluation of `resource` and `provide` nodes per §5
- runtime resource lifecycle: child creation, initialization,
  provide handling, parent resumption, background lifetime,
  and deterministic coroutineId allocation per §6.1–6.2
- teardown and cleanup ordering per §6.3 and §6.6
- failure semantics per §6.4: init failure, background
  failure, cleanup failure
- cancellation semantics per §6.5 (conservative v1 rule set)
- journal ordering per §7
- replay and durability per §8
- scope inheritance per §3.1 RS6

Additionally, §9 of this plan defines a dedicated set of
**draft prototype validation tests** corresponding to the
teardown-resumption acceptance criteria in resource
specification §11.

### 1.2 What This Plan Does Not Cover

The following are explicitly outside the scope of this test
plan. They correspond to the deferred extensions listed in
resource specification §12.

- resource carrying handler or binding metadata directly
  (§12.1)
- resource inside `all` or `race` bodies (§12.2)
- resource-to-resource nesting edge cases (§12.3)
- transport binding compilation to resource internals (§12.4)
- post-provide non-finally arbitrary code (§12.5)
- multi-provide or streaming resources (§12.6)
- explicit resource disposal before scope exit (§12.7)
- cancellation cleanup guarantees beyond what the draft spec
  commits to (§12.8)
- runtime behavior for hand-constructed IR containing
  `provide` outside resource orchestration context (not
  normatively defined; see §11 non-tests)

Tests that would validate deferred behavior are listed in §11
(Explicit Non-Tests) for tracking purposes.

### 1.3 Observability Model

All tests compare observable outputs only:

- **Compiler tests:** acceptance (produces conforming IR) or
  rejection (produces a diagnostic identifying the violated
  constraint). Diagnostics are compared by violated-rule
  category, not by message wording or error code number.
- **Runtime tests:** result value, result status, and journal
  event sequence. Journal events are compared using canonical
  JSON equality per the existing conformance harness.
- **Replay tests:** journal event sequence after replay
  matches the expected sequence. Deterministic reconstruction
  from IR and environment is verified by comparing replay
  output to original output.

No test depends on implementation internals, intermediate
compiler state, runtime step ordering beyond normative
ordering constraints, the relative global interleaving order
of parent and child journal events, or the internal
representation of the provided value delivery mechanism.

In particular: cross-coroutineId ordering of `YieldEvent`s is
NOT asserted. The parent blocks until provide (R5), which
causally guarantees the parent cannot yield effects until after
the child's init effects, but this plan verifies blocking
through the parent's received value and result, not through
global journal event positions.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST pass.
A resource implementation is non-conforming if any Core test
fails. Core tests verify only behavior that the resource
specification commits to via MUST or MUST NOT rules.

**Extended:** Tests for edge cases, boundary conditions,
defensive runtime checks, and diagnostic quality. Extended
tests verify SHOULD-level behavior or implementation
robustness. They are recommended but not required for
conformance.

**Draft:** Tests that validate teardown-resumption runtime
mechanics corresponding to resource specification §11.2.
Draft tests gate spec advancement: the resource specification
MUST NOT advance from Draft to "Ready for approval" status
until all Draft tier tests pass. Draft tests do NOT gate
implementation conformance — an implementation that passes
all Core tests is conforming to the current draft spec even
if Draft tests have not yet been executed. The Draft tier
exists solely because the spec explicitly marks
teardown-resumption as draft-stage implementation-validated.

---

## 2. Fixture Schema Extensions

### 2.1 Resource Runtime Fixture

````typescript
interface ResourceRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended" | "draft";
  category: string;
  spec_ref: string;
  description: string;
  type: "resource_runtime";
  ir: Expr;                    // root IR expression
  env: Record<string, Val>;    // execution environment
  expected: {
    status: "ok" | "error" | "cancelled";
    value?: Val;               // for status "ok"
    error?: string;            // error category for "error"
    journal: {
      [coroutineId: string]: Array<YieldEntry | CloseEntry>;
    };
    journal_ordering?: Array<OrderingConstraint>;
  };
}
````

The `journal` field uses per-coroutineId event sequences,
following the spawn test plan convention. Cross-coroutineId
ordering is validated only via explicit `journal_ordering`
constraints (child Close before parent Close), never by
global position of `YieldEvent`s.

### 2.2 Resource Compiler Fixture

Uses the existing `CompilerAcceptanceFixture` and
`CompilerRejectionFixture` types from the blocking scope test
plan. The `violated_rule` field references resource
specification constraint identifiers (RS1–RS6, P1–P7, C1–C9).

### 2.3 Ordering Constraint Schema

Uses the existing `OrderingConstraint` type from the spawn
test plan.

````typescript
interface OrderingConstraint {
  type: "before";
  earlier: { coroutineId: string; event: "close" };
  later: { coroutineId: string; event: "close" };
}
````

### 2.4 Existing Fixture Types

Kernel evaluation tests use the existing `effect` fixture type
to observe yield behavior. Replay tests extend runtime
fixtures with `stored_journal` inputs.

---

## 3. Compiler Acceptance Tests

### 3.1 Valid `resource(...)` Forms

| ID | Tier | Rule | Description | Source shape | Expected |
|---|---|---|---|---|---|
| RS-C-001 | Core | RS1, RS2, P4a | Minimal resource: one provide, no cleanup | `yield* resource(function*() { yield* provide(42); })` | Accepted; resource node with body containing Eval("provide", ...) |
| RS-C-002 | Core | RS1, P4b, §3.3 | Resource with try/finally cleanup | `yield* resource(function*() { try { yield* provide(x); } finally { yield* agent.cleanup(); } })` | Accepted; body contains try node with provide in body and agent call in finally |
| RS-C-003 | Core | RS4, P3 | Resource with init effects before provide | `yield* resource(function*() { const v = yield* agent.init(); yield* provide(v); })` | Accepted; body contains Let binding init call then provide |
| RS-C-004 | Core | RS3 | Resource body containing nested scoped block | `yield* resource(function*() { const v = yield* scoped(function*() { yield* useTransport(...); ... return val; }); yield* provide(v); })` | Accepted; body contains scope node then provide |
| RS-C-005 | Core | RS2 | Resource result bound to const | `const session = yield* resource(function*() { yield* provide(id); });` | Accepted; resource lowered inside Let binding |
| RS-C-006 | Core | P1, C9 | Provide value expression is compiled, not quoted | `yield* provide(someExpr)` inside resource body | Accepted; provide node data is compiled expression, not Quote-wrapped |
| RS-C-007 | Extended | RS4, P4b | Resource with multiple init effects and try/finally | Three init agent calls followed by try/provide/finally | Accepted |
| RS-C-008 | Extended | RS5 | Resource in body position after other statements | Resource call following two other agent calls | Accepted |

---

## 4. Compiler Rejection Tests

### 4.1 Resource Form Violations

| ID | Tier | Rule | Description | Source | Violated rule |
|---|---|---|---|---|---|
| RS-C-020 | Core | RS1 | resource argument is not a generator function | `yield* resource(42)` | RS1 |
| RS-C-021 | Core | RS1 | resource argument is an arrow function | `yield* resource(() => { ... })` | RS1 |
| RS-C-022 | Core | RS4 | resource body with no provide | `yield* resource(function*() { return 42; })` | RS4 / P3 |

### 4.2 Provide Placement Violations

| ID | Tier | Rule | Description | Source | Violated rule |
|---|---|---|---|---|---|
| RS-C-030 | Core | P2 | provide outside resource body | `yield* provide(42)` at workflow top level | P2 |
| RS-C-031 | Core | P2 | provide inside spawn body | `yield* spawn(function*() { yield* provide(42); })` | P2 |
| RS-C-032 | Core | P5 | provide inside if block | `yield* resource(function*() { if (c) { yield* provide(a); } else { yield* provide(b); } })` | P5 |
| RS-C-033 | Core | P5 | provide inside while loop | `yield* resource(function*() { while (c) { yield* provide(v); } })` | P5 |
| RS-C-034 | Core | P5 | provide inside nested scoped block | `yield* resource(function*() { yield* scoped(function*() { yield* provide(v); }); })` | P5 |
| RS-C-035 | Core | P5 | provide inside nested generator helper | `function* helper() { yield* provide(v); }` called from resource body | P5 |
| RS-C-036 | Core | P3 | multiple provides on same path | `yield* resource(function*() { yield* provide(a); yield* provide(b); })` | P3 (and P6) |
| RS-C-037 | Core | P6 | code after provide at same level | `yield* resource(function*() { yield* provide(v); yield* agent.extra(); })` | P6 |
| RS-C-038 | Extended | P1 | provide without yield* | `yield* resource(function*() { provide(42); })` | P1 |
| RS-C-039 | Extended | P5 | provide inside all block | `yield* resource(function*() { yield* all(function*() { yield* provide(v); }, ...); })` | P5 |

---

## 5. IR Lowering Tests

| ID | Tier | Rule | Description | Input | Expected IR shape |
|---|---|---|---|---|---|
| RS-IR-001 | Core | §4.1, C4 | resource lowers to Eval("resource", Quote({body})) | `yield* resource(function*() { yield* provide(42); })` | `Eval("resource", Quote({ body: Eval("provide", Literal(42)) }))` |
| RS-IR-002 | Core | §4.2, C9 | provide lowers to Eval("provide", compiledExpr) | `yield* provide(someRef)` inside resource body | `Eval("provide", Ref("someRef"))` — NOT Quote-wrapped |
| RS-IR-003 | Core | §4.1 | resource node carries no handler or binding metadata | `yield* resource(function*() { ... })` inside scoped block with useTransport | resource Quote contains only `body` field; no `handler`, no `bindings` |
| RS-IR-004 | Core | §4.2 | provide value expression compiled, not quoted | `yield* provide(yield* agent.init())` | provide data is compiled agent call Eval node, not wrapped in Quote |
| RS-IR-005 | Core | §4.3 V1 | resource body is valid IR expression | resource with agent call and provide | body field is well-formed Expr |
| RS-IR-006 | Extended | C4, C9 | Full compilation: init + try/provide/finally | Source from §3.4 | IR contains Let for init binding, try node with provide in body and agent call in finally |

---

## 6. Kernel Evaluation Tests

These tests verify kernel behavior for `resource` and
`provide` nodes in isolation, independent of runtime resource
lifecycle. They use the existing `effect` fixture type to
observe the kernel's yield behavior.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-K-001 | Core | §5.1 | classify("resource") returns EXTERNAL | Kernel classification query | `EXTERNAL` |
| RS-K-002 | Core | §5.1 | classify("provide") returns EXTERNAL | Kernel classification query | `EXTERNAL` |
| RS-K-003 | Core | §5.1 | isCompoundExternal("resource") returns true | Kernel classification query | `true` |
| RS-K-004 | Core | §5.1 | isCompoundExternal("provide") returns true | Kernel classification query | `true` |
| RS-K-005 | Core | §5.2 | Kernel yields descriptor with id "resource" | Evaluate `Eval("resource", Quote({ body: Eval("provide", 42) }))` | Kernel yields descriptor with `id: "resource"`; descriptor data contains the unquoted body expression |
| RS-K-006 | Core | §5.2 | Kernel does not evaluate body before yielding resource descriptor | Resource body contains agent Eval that would produce a second yield | Kernel yields exactly one descriptor (the resource descriptor); body Eval is not reached |
| RS-K-007 | Core | §5.3 | Kernel yields descriptor with id "provide" and evaluated value | Evaluate `Eval("provide", Ref("x"))` with env `{ x: 42 }` | Kernel yields descriptor with `id: "provide"`; descriptor data contains the evaluated value `42`, not the unevaluated `Ref("x")` |
| RS-K-008 | Extended | §5.3 | Provide evaluates complex expression before yielding | Evaluate `Eval("provide", Eval("add", Quote({ a: Ref("x"), b: 1 })))` with env `{ x: 10 }` | Kernel yields provide descriptor with data containing value `11` |

> **Note on observability.** RS-K-005 is observable through the
> kernel's yield behavior: compound-external nodes yield
> descriptors via the `unquote` path. RS-K-007 verifies that
> `provide`'s non-Quote data is evaluated (not preserved as an
> expression), observable by comparing the descriptor's data to
> the expected resolved value. RS-K-006 is observable by
> counting kernel yields. RS-K-008 is Extended because it
> verifies general `unquote` → `eval` behavior for compound-
> externals with non-Quote data, not a resource-specific
> semantic.

---

## 7. Runtime Lifecycle Tests

These tests use hand-constructed resource IR (not compiled
source) to verify runtime behavior independently of the
compiler. They follow the existing `effect` fixture pattern:
provide IR, mock effects, compare result and journal.

### 7.1 Resource Entry and Value Provision

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-R-001 | Core | R1 | Child coroutineId allocated deterministically | Resource as first compound-external in parent | child coroutineId = `child_id(parent_id, 0)` |
| RS-R-002 | Core | R1 | Resource shares childSpawnCount with scope/spawn/all/race | Parent runs `scoped(...)` (index 0) then `resource(...)` | Resource child = `child_id(parent_id, 1)` |
| RS-R-003 | Core | R3, R4, R5 | Parent receives provided value | Resource body: one init effect (returns 10), provide(10); parent uses value in subsequent effect | Parent result incorporates provided value; child has init YieldEvent under child coroutineId |
| RS-R-004 | Core | R5 | Parent resumes with correct provided value and continues | Resource body: two init effects, then provide(result); parent: one effect using provided value | Parent's post-resource effect uses the provided value; parent result is ok |
| RS-R-005 | Core | R7, R8 | No YieldEvent for provide in child journal | Resource body: one init effect, provide | Child coroutineId has one YieldEvent (init, yieldIndex 0); no event with description matching "provide" |
| RS-R-006 | Core | R6, R23 | Child CloseEvent written during scope teardown, not at provide | Resource with provide; parent makes two agent calls after resource | Child CloseEvent appears during parent scope exit; ordering constraint: child Close before parent Close |

### 7.2 Teardown

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-R-010 | Core | R10, R11, R12 | Cleanup runs on normal parent exit | Resource with try/provide/finally containing one cleanup effect; parent returns | Cleanup YieldEvent at child yieldIndex 1 (continuing from init at 0); child Close(ok); parent Close(ok) |
| RS-R-011 | Core | R11 | Cleanup yieldIndex continues init sequence | Resource: two init effects, provide, finally with one cleanup effect | Init at yieldIndex 0, 1; cleanup at yieldIndex 2 |
| RS-R-012 | Core | R10 | Cleanup runs on parent error | Resource with try/provide/finally; parent throws after resource | Cleanup YieldEvent under child id; child Close(ok); parent Close(err) |
| RS-R-013 | Core | R21 | Multiple resources tear down in reverse order | Parent creates resource A (childId .0), then resource B (childId .1); both have cleanup effects | Ordering constraint: B Close before A Close; both before parent Close |
| RS-R-014 | Core | R22 | Resource's own children tear down before resource cleanup | Resource body spawns a child during init; resource has finally cleanup | Ordering constraint: spawned child Close before resource child Close |
| RS-R-015 | Core | R23 | Child Close before parent Close | Resource with cleanup; parent returns | Ordering constraint: child Close before parent Close |
| RS-R-016 | Core | R24 | Resource teardown completes before parent CloseEvent | Resource with cleanup; parent returns | Child cleanup YieldEvents and child Close all precede parent Close |

### 7.3 Failure

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-R-020 | Core | R13, R14 | Init failure propagates to parent | Resource body throws before provide | Child Close(err); parent receives error |
| RS-R-021 | Core | R13 | Init failure is catchable at resource call site | Resource in try block; body throws before provide; catch makes marker effect | Marker effect in parent journal; parent result is ok (caught) |
| RS-R-022 | Core | R14 | Init failure writes child Close before parent error | Resource body throws before provide | Ordering constraint: child Close(err) before parent error propagation |
| RS-R-023 | Core | R15, R16 | Background failure crashes parent scope | Resource provides; spawned child in resource body fails | Parent result is err; parent try/catch around resource does NOT catch (verified by absence of catch marker effect) |
| RS-R-024 | Core | R17 | Cleanup failure records error in child CloseEvent | Resource with finally that throws; parent exits normally | Child Close(err); error propagates upward |
| RS-R-025 | Extended | R13 | Init agent call fails (effect error) | Resource body has agent call returning err; provide unreachable | Child Close(err); parent try/catch can catch |

### 7.4 Defensive Runtime Checks

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-R-030 | Extended | V2 | Runtime detects missing provide (SHOULD) | Hand-constructed resource IR with body that returns without reaching provide | Runtime error; child Close(err). This tests a SHOULD-level recommendation (V2), not a MUST |

---

## 8. Journal and Replay Tests

### 8.1 Journal Ordering

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-J-001 | Core | §7.1 | No new event types in journal | Full resource lifecycle with init and cleanup | Journal contains only YieldEvent and CloseEvent types |
| RS-J-002 | Core | §7.2 | Init effects journaled under child coroutineId | Resource with two init effects | Two YieldEvents under child coroutineId at yieldIndex 0, 1 |
| RS-J-003 | Core | §7.3 | No journal event for provide | Resource with one init effect and provide | One YieldEvent (init) under child; no event with description matching "provide" |
| RS-J-004 | Core | §7.4 | Cleanup effects continue yieldIndex | Resource: one init effect, provide, finally with one cleanup effect | Init at yieldIndex 0; cleanup at yieldIndex 1 |
| RS-J-005 | Core | §7.5 | No parent YieldEvent for resource | Parent has effects before and after resource | Parent yieldIndex sequence has no gap or event for the resource itself |
| RS-J-006 | Core | R23 | Child Close before parent Close | Full lifecycle | Ordering constraint: child Close(ok) before parent Close(ok) |
| RS-J-007 | Core | R21 | Multiple resources: reverse-order Close | Two resources with cleanup | Ordering constraint: second resource Close before first; both before parent Close |
| RS-J-008 | Extended | §7.4 | Cleanup with multiple effects continues yieldIndex | Two init effects, provide, two cleanup effects | Init at 0, 1; cleanup at 2, 3 |

### 8.2 Replay

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-RP-001 | Core | RR4, RR5 | Replay produces same provided value | Full resource journal (init + cleanup + close) | Replay: parent receives same value; same result |
| RS-RP-002 | Core | RR3 | Per-coroutineId replay cursors independent | Resource child has init events | Child replays from own cursor |
| RS-RP-003 | Core | §8.2 | Provided value recomputed from replayed init | Init effect returns unique value; journal has init YieldEvent | On replay: init replays from journal; provided value is the result of replaying the child, not a stored entry |
| RS-RP-004 | Core | RR1 | CoroutineId identical on replay | Two resources in workflow | All coroutineIds match original |
| RS-RP-005 | Core | RR7 | Cleanup events replay during teardown | Full journal with cleanup YieldEvents and child Close | Cleanup events replay from journal when parent scope exits |
| RS-RP-006 | Core | §8.3 | Replay produces identical result (success) | Complete journal | Same values, same per-coroutineId events |
| RS-RP-007 | Core | §8.3 | Replay produces identical result (init failure) | Journal with child Close(err) | Same error, same events |

### 8.3 Crash Recovery

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-RP-010 | Core | §8.4 | Crash before resource: full re-execution | Empty journal | Resource executes live |
| RS-RP-011 | Core | §8.4 | Crash during init: partial child replay | Partial child journal (some init events) | Child replays available events, transitions to live |
| RS-RP-012 | Core | §8.4 | Crash after provide, parent in progress | Child init events in journal; no cleanup | Child replays init, re-provides; parent replays; cleanup runs live |
| RS-RP-013 | Core | §8.4 | Crash during cleanup | Init + partial cleanup events | Init replays; partial cleanup replays, rest dispatched live |
| RS-RP-014 | Core | §8.4 | Crash after child Close | Complete child journal | Full replay |
| RS-RP-015 | Extended | §8.4 | Crash with multiple resources at different progress | Two resources: one closed, one mid-init | Complete replays fully; partial transitions to live |

---

## 9. Draft Prototype Validation Tests

These tests correspond directly to the teardown-resumption
acceptance criteria defined in resource specification §11.2.
They validate the runtime mechanism by which the child kernel
is resumed from the provide suspension during teardown, its
cleanup effects are journaled, and the sequence replays
correctly.

These tests MUST pass before the resource specification
advances from Draft to "Ready for approval" status. They do
NOT gate implementation conformance to the current draft.

The Draft section is intentionally small. It contains only the
three checks identified in the spec's §11.2 and does not
expand into a second full conformance suite.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-DV-001 | Draft | §11.2 Check 1 | Normal teardown with cleanup | Resource body: one init agent call (returns 10), `try { provide(10) } finally { one cleanup agent call }`. Parent returns normally | Init YieldEvent at child yieldIndex 0; cleanup YieldEvent at child yieldIndex 1; child Close(ok); parent Close(ok). Replay produces identical events and result |
| RS-DV-002 | Draft | §11.2 Check 2 | Cancellation at provide | Resource body: one init agent call, `provide(value)` (no try/finally). Parent scope cancelled externally | Init YieldEvent at child yieldIndex 0; child Close(cancelled); parent Close(cancelled). Replay produces identical events |
| RS-DV-003 | Draft | §11.2 Check 3 | Cleanup failure | Resource body: one init agent call, `try { provide(value) } finally { agent call that returns err }`. Parent returns normally | Init YieldEvent at child yieldIndex 0; cleanup YieldEvent at child yieldIndex 1 with err result; child Close(err); error propagates to parent. Replay produces identical events |

> **Note.** RS-DV-001 through RS-DV-003 overlap semantically
> with Core tests RS-R-010, RS-R-024, and RS-X-001. The
> overlap is intentional: Core tests verify semantic
> conformance; Draft tests additionally verify the replay
> round-trip for each scenario. An implementation that passes
> all Core tests satisfies the semantic contract. Draft tests
> additionally confirm the implementation mechanism survives
> replay, which is the specific remaining draft-stage
> uncertainty.

---

## 10. Cancellation Tests

These tests reflect the draft spec's conservative v1
cancellation rules (§6.5 R18–R20). They do NOT assert
stronger cleanup guarantees than the spec provides.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-X-001 | Core | R18, R19 | Child cancelled when parent is cancelled | Resource with init effect and provide; parent cancelled | Child Close(cancelled) |
| RS-X-002 | Core | R18 | Cancellation during init phase | Resource body suspended on init effect when parent cancelled | Child Close(cancelled); no provide reached |
| RS-X-003 | Extended | R20 | Finally execution during cancellation is not guaranteed | Resource with try/provide/finally; parent cancelled | Child Close(cancelled) is required. Whether cleanup YieldEvent appears is implementation-dependent and MUST NOT be asserted by this test. R20 explicitly does not require finally execution during cancellation |

> **Note on RS-X-003.** This test verifies that the harness
> does NOT assert finally-block execution during cancellation.
> A conforming implementation MAY run cleanup (producing
> YieldEvents) or MAY NOT (producing only Close(cancelled)).
> The test is classified Extended because it validates that
> the test suite itself respects the v1 limitation — it is a
> discipline check, not a feature test.

---

## 11. Explicit Non-Tests (Deferred Coverage)

| ID | Deferred Item | Spec ref | Why excluded |
|---|---|---|---|
| RS-NT-001 | Resource carrying handler/binding metadata | §12.1 | Not supported; child uses nested scoped |
| RS-NT-002 | Resource inside all body | §12.2 | Join interaction not designed |
| RS-NT-003 | Resource inside race body | §12.2 | Join interaction not designed |
| RS-NT-004 | Resource-to-resource nesting | §12.3 | Edge cases not specified |
| RS-NT-005 | Transport compiles to resource | §12.4 | Migration deferred |
| RS-NT-006 | Arbitrary code after provide | §12.5 | P6 restricts; future relaxation |
| RS-NT-007 | Multiple provides (streaming) | §12.6 | Different pattern |
| RS-NT-008 | Explicit disposal before scope exit | §12.7 | Breaks lifetime model |
| RS-NT-009 | Finally guaranteed during cancellation | §12.8 | V1 conservative; R20 does not guarantee |
| RS-NT-010 | Provided value across scope boundaries | §12.8 | Not restricted; behavioral limits deferred |
| RS-NT-011 | Runtime behavior for standalone `provide` outside resource context | §3.2 P2, §4.3 V2 | `provide` validity is a compiler obligation (P2). Runtime detection is SHOULD (V2). Behavior for hand-constructed IR containing `provide` outside resource orchestration is implementation-defined and not a conformance concern |

---

## 12. Inheritance Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| RS-I-001 | Core | RS6 | Resource child inherits parent transport binding | Parent scoped block installs binding for agent A; resource body calls A during init | Agent call dispatched; YieldEvent under child coroutineId |
| RS-I-002 | Core | RS6 | Resource child inherits parent enforcement wrapper | Parent scoped block installs deny-all handler; resource body calls agent during init | Agent call denied; child Close(err) |
| RS-I-003 | Core | RS3, RS6 | Nested scoped in resource body extends middleware | Parent has pass-through handler; resource body contains scoped block with deny handler | Agent denied by inner handler |

---

## 13. Coverage Summary

### 13.1 Test Count Summary

| Category | Core | Extended | Draft | Total |
|---|---|---|---|---|
| Compiler acceptance | 6 | 2 | — | 8 |
| Compiler rejection | 8 | 2 | — | 10 |
| IR lowering | 5 | 1 | — | 6 |
| Kernel evaluation | 7 | 1 | — | 8 |
| Runtime lifecycle | 15 | 2 | — | 17 |
| Journal ordering | 7 | 1 | — | 8 |
| Replay | 12 | 1 | — | 13 |
| Cancellation | 2 | 1 | — | 3 |
| Draft prototype | — | — | 3 | 3 |
| Inheritance | 3 | — | — | 3 |
| **Total** | **65** | **11** | **3** | **79** |

Explicit non-tests: 11

---

## 14. Conformance Rule

An implementation passes resource conformance if and only if:

1. All Core tier compiler acceptance fixtures produce a
   resource node conforming to the expected IR shape.

2. All Core tier compiler rejection fixtures produce a
   diagnostic that identifies the violated constraint
   category.

3. All Core tier kernel evaluation fixtures produce the
   expected descriptor yield behavior.

4. All Core tier runtime lifecycle, journal ordering, replay,
   cancellation, and inheritance fixtures produce the expected
   result status, result value (canonical JSON equality), and
   journal event sequence (canonical JSON equality per event).

5. No Core tier fixture produces an unexpected error, hangs,
   or crashes.

Additionally, the resource specification MUST NOT advance from
Draft to "Ready for approval" status until all Draft tier
fixtures (RS-DV-001 through RS-DV-003) also pass.

---

## Appendix A: Implementation Notes

> **Non-normative.** The following notes may help implementers
> build a test harness for the resource conformance plan.

### A.1 Resource fixture harness

Resource runtime tests use hand-constructed resource IR as
input. The existing conformance harness can be extended by
adding `"resource"` and `"provide"` to the kernel's
compound-external set and adding the resource orchestration
handler to the runtime's dispatch loop. Mock dispatch
middleware is used for agent effect responses within resource
bodies.

### A.2 Provide observability

R7 (no YieldEvent for provide) and R8 (no yieldIndex advance)
are verified by inspecting the complete journal and confirming
the absence of any event with a description matching
`{ type: "provide", name: "provide" }`. The child's yieldIndex
sequence should advance from the last init event directly to
the first cleanup event with no gap.

### A.3 Teardown trigger

Tests RS-R-010 through RS-R-016 require the parent scope to
exit and trigger resource teardown. This is achieved by having
the parent return a value after the resource call, causing the
parent's scoped block to complete and tear down its children.

### A.4 Background failure trigger

RS-R-023 requires a resource body that spawns a background
child failing after the parent resumes. Construct by: (1)
resource body spawns a child that makes a failing agent call;
(2) resource body provides a value; (3) parent makes an agent
call after resource. The test verifies the final result is err
and the parent's catch block around resource does NOT execute
(no catch marker effect). The test does NOT assert timing of
the parent's post-resource agent call relative to the
background child's failure — that ordering is schedule-
dependent.

### A.5 Cancellation trigger

Cancellation tests require the test harness to cancel the
parent scope while the resource child is alive. Implement by
spawning the execution in a structured scope and halting it
after the resource child's init YieldEvent is observed. This
follows the blocking-scope test plan approach (Appendix A.3).

### A.6 Replay fixture construction

Replay fixtures require constructing `stored_journal` entries
with the correct child coroutineId. For a resource as the
first compound-external child of the root, the child id is
`child_id("root", 0)` = `"root.0"`.

### A.7 Cross-coroutineId ordering discipline

This plan never asserts global journal positions of
`YieldEvent`s across coroutineIds. The parent blocks until
provide (R5), which causally guarantees the parent cannot
yield effects until after the child's init effects. But this
plan verifies blocking through the parent's received value
and result, not through journal event positions. Only
`CloseEvent` ordering is verified via explicit
`OrderingConstraint` entries in fixtures. This follows the
spawn test plan's approach (spawn test SP-J-006).

### A.8 Draft tier execution

Draft tier tests are executed identically to Core tier tests.
The tier distinction is administrative: Draft tests gate spec
advancement, not implementation conformance. An implementation
that passes all Core tests but fails a Draft test is
conforming to the current draft spec but is insufficient for
spec promotion.
