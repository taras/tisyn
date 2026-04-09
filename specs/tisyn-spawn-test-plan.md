# Tisyn Spawn — Conformance Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Spawn Specification 0.1.0
**Status:** Draft

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the
non-blocking `spawn(...)` MVP as specified in the Tisyn Spawn
Specification v0.1.0. It covers:

- compiler acceptance and rejection of authored `spawn(...)`
  and `yield* handle` forms per §3
- IR lowering of `spawn(...)` and task-handle join per §4
  and §9
- kernel evaluation of `spawn` and `join` nodes per §5
- runtime spawn lifecycle: non-blocking child creation,
  task-handle provision, join semantics, concurrent execution,
  and deterministic coroutineId allocation per §6
- failure propagation and catchability boundaries per §6.4
  and §10.2
- journal ordering for concurrent parent-child execution
  per §7
- replay and durability per §8
- inherited contract availability and middleware wrappers
  per §3.5–3.6

### 1.2 What This Plan Does Not Cover

The following are explicitly outside the scope of this test
plan. They correspond to the deferred extensions listed in
spawn specification §11.

- detached / unstructured background tasks (§11.1)
- `spawn(...)` carrying its own setup, bindings, or handler
  metadata (§11.2)
- `resource(...)` value provision (§11.3)
- stream / collection consumption patterns (§11.4)
- per-child error catching at the `yield* handle` join point
  (§11.5)
- `spawn(...)` inside a scope's setup prefix (§11.6)
- task-handle passing across scope boundaries (§11.7)
- future schedule-aware or buffered supervision behavior
- richer supervision models beyond unconditional failure
  propagation

Tests that would validate deferred behavior are listed in §10
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
ordering constraints, the relative global interleaving
order of parent and child journal events, or the internal
representation of opaque capability values such as task
handles.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST pass.
A spawn implementation is non-conforming if any Core test
fails.

**Extended:** Tests for edge cases, boundary conditions, and
diagnostic quality. Recommended but not required for initial
conformance.

---

## 2. Fixture Schema Extensions

### 2.1 Spawn Runtime Fixture

````typescript
interface SpawnRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "spawn_runtime";
  ir: Expr;                    // root IR expression
  args: Record<string, Val>;   // workflow arguments
  env: Record<string, Val>;    // execution environment
  expected: {
    status: "ok" | "error" | "cancelled";
    value?: Val;               // for status "ok"
    error?: string;            // error category for "error"
    journal: {
      // per-coroutineId expected events
      [coroutineId: string]: Array<YieldEntry | CloseEntry>;
    };
    journal_ordering?: Array<OrderingConstraint>;
  };
}
````

The `journal` field uses per-coroutineId event sequences. Each
coroutineId's events MUST appear in `yieldIndex` order within
that coroutineId. Cross-coroutineId ordering is validated only
via explicit `journal_ordering` constraints (e.g., "child
Close before parent Close"), never by global position.

### 2.2 Spawn Compiler Fixture

Uses the existing `CompilerAcceptanceFixture` and
`CompilerRejectionFixture` types from the blocking scope test
plan. The `violated_rule` field references spawn specification
constraint identifiers (SP1–SP15, C1–C9).

### 2.3 Ordering Constraint Schema

````typescript
interface OrderingConstraint {
  type: "before";
  earlier: { coroutineId: string; event: "close" };
  later: { coroutineId: string; event: "close" };
}
````

---

## 3. Compiler Acceptance Tests

### 3.1 Valid `spawn(...)` Forms

| ID | Tier | Rule | Description | Source shape | Expected |
|---|---|---|---|---|---|
| SP-C-001 | Core | §3.1, SP1 | Fire-and-forget spawn: bare statement | `yield* spawn(function*() { yield* agent.call(x); });` | Accepted; spawn node with body containing agent eval |
| SP-C-002 | Core | §3.1, SP1 | Spawn with const binding | `const task = yield* spawn(function*() { return 42; });` | Accepted; spawn node; task recorded as spawn-handle binding |
| SP-C-003 | Core | SP5 | Join as bare statement | `const t = yield* spawn(fn); yield* t;` | Accepted; join node emitted for `yield* t` |
| SP-C-004 | Core | SP5 | Join as const initializer | `const t = yield* spawn(fn); const result = yield* t;` | Accepted; join node; result bound to join value |
| SP-C-005 | Core | SP5 | Join as let initializer | `const t = yield* spawn(fn); let result = yield* t;` | Accepted; join node |
| SP-C-006 | Core | SP5 | Join as return expression | `const t = yield* spawn(fn); return yield* t;` | Accepted; join node in return position |
| SP-C-007 | Core | SP8 | Spawn inside if branch | `if (cond) { yield* spawn(function*() { ... }); }` | Accepted |
| SP-C-008 | Core | SP8 | Spawn inside while body | `while (cond) { yield* spawn(function*() { ... }); }` | Accepted |
| SP-C-009 | Core | SP8 | Spawn inside try block | `try { const t = yield* spawn(fn); yield* t; } catch (e) { ... }` | Accepted |
| SP-C-010 | Core | SP9 | Spawned body containing agent call | `spawn(function*() { const h = yield* useAgent(A); return yield* h.method(x); })` | Accepted; body contains erased useAgent + agent eval |
| SP-C-011 | Core | SP9 | Spawned body containing nested scoped | `spawn(function*() { return yield* scoped(function*() { ... }); })` | Accepted; body contains scope node |
| SP-C-012 | Core | SP9 | Spawned body containing nested spawn | `spawn(function*() { yield* spawn(function*() { ... }); })` | Accepted; body contains nested spawn node |
| SP-C-013 | Extended | SP9 | Spawned body containing all/race | `spawn(function*() { return yield* all([...]); })` | Accepted; body contains all node |

### 3.2 `spawn(...)` Form Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SP-C-020 | Core | §3.1 | spawn with arrow function argument | `spawn(() => { ... })` | §3.1 |
| SP-C-021 | Core | §3.1 | spawn with non-generator function | `spawn(function() { ... })` | §3.1 |
| SP-C-022 | Core | §3.1 | spawn with identifier argument | `spawn(myFn)` | §3.1 |
| SP-C-023 | Extended | §3.1 | spawn with no argument | `spawn()` | §3.1 |
| SP-C-024 | Core | SP2 | spawn bound to let declaration | `let task = yield* spawn(function*() { ... });` | SP2 |

### 3.3 Placement Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SP-C-030 | Core | SP7 | spawn in setup prefix before body | `scoped(function*() { yield* spawn(fn); yield* useTransport(A, t); })` where spawn precedes first body statement | SP7 |
| SP-C-031 | Core | SP7 | spawn between useTransport and Effects.around | `scoped(function*() { yield* useTransport(A, t); yield* spawn(fn); yield* Effects.around({...}); })` | SP7 |

### 3.4 Task Handle Usage Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SP-C-040 | Core | SP4 | Handle passed as agent call argument | `const t = yield* spawn(fn); yield* agent.call(t);` | SP4 |
| SP-C-041 | Core | SP4 | Handle returned from workflow | `const t = yield* spawn(fn); return t;` | SP4 |
| SP-C-042 | Core | SP4 | Handle stored in object | `const t = yield* spawn(fn); const obj = { task: t };` | SP4 |
| SP-C-043 | Core | SP4 | Handle stored in array | `const t = yield* spawn(fn); const arr = [t];` | SP4 |
| SP-C-044 | Core | SP3 | Handle used in non-join expression | `const t = yield* spawn(fn); console.log(t);` | SP3 |
| SP-C-045 | Extended | SP6 | Duplicate join (statically detectable) | `const t = yield* spawn(fn); yield* t; yield* t;` | SP6 (SHOULD reject; static detection is recommended, not required) |

### 3.5 Lexical Capture and Inheritance

| ID | Tier | Rule | Description | Source shape | Expected |
|---|---|---|---|---|---|
| SP-C-050 | Core | SP11(A), C3b | Workflow parameter captured in spawned body | `function*(spec) { yield* spawn(function*() { yield* agent.call(spec); }); }` | Accepted; spawned body contains `Ref("spec")` |
| SP-C-051 | Core | SP11(A), C3b | const binding captured in spawned body | `const x = yield* agent.call(y); yield* spawn(function*() { yield* agent.call(x); });` | Accepted; spawned body contains `Ref("x")` |
| SP-C-052 | Core | SP11(B), C8 | Parent useAgent handle referenced in spawned body | Parent has `const h = yield* useAgent(A)`, spawned body uses `yield* h.method(x)` | Rejected; SP11(B) violated — parent handle not visible |
| SP-C-053 | Core | SP11(C), C3a | useAgent in spawned body for parent-bound contract | Parent scope has `useTransport(A, t)`, spawned body has `const h = yield* useAgent(A)` | Accepted; inherited contract validates useAgent |
| SP-C-054 | Core | SP11(C), C3a | useAgent in spawned body for unbound contract | No parent useTransport for B, spawned body has `yield* useAgent(B)` | Rejected; no contract availability |
| SP-C-055 | Extended | SP11(A), C3b | let binding captured at spawn-time value | `let x = 1; x = 2; yield* spawn(function*() { yield* agent.call(x); });` | Accepted; spawned body captures the value of `x` at the point of the `spawn(...)` call (value 2), not subsequent reassignments. The compiler's internal mechanism for achieving this (e.g., SSA versioning) is implementation-defined |

---

## 4. IR Lowering Tests

| ID | Tier | Rule | Description | Input | Expected IR shape |
|---|---|---|---|---|---|
| SP-IR-001 | Core | §4.1, C4 | spawn lowers to Eval("spawn", Quote({body})) | `yield* spawn(function*() { return 42; })` | `Eval("spawn", Quote({ body: Literal(42) }))` |
| SP-IR-002 | Core | §4.2, C6 | join lowers to Eval("join", Ref(handle)) | `const t = yield* spawn(fn); yield* t;` | spawn node followed by `Eval("join", Ref("t"))` |
| SP-IR-003 | Core | §4.1 | spawn node carries no handler or binding metadata | `yield* spawn(function*() { ... })` inside a scoped block with useTransport | spawn Quote contains only `body` field; no `handler`, no `bindings` |
| SP-IR-004 | Core | §4.3, C5 | Task handle binding via Let | `const t = yield* spawn(fn); const r = yield* t;` | `Let("t", Eval("spawn", ...), Let("r", Eval("join", Ref("t")), ...))` |
| SP-IR-005 | Core | §4.4 V1 | Spawn body is valid IR expression | Spawn with agent call body | body field is well-formed Eval node |
| SP-IR-006 | Core | §4.4 V2 | Join data is valid Ref node | `yield* t` where t is spawn handle | join data is `Ref("t")` |
| SP-IR-007 | Extended | Appendix B | Full compilation example matches spec | Source from Appendix B | IR matches structure from Appendix B |

---

## 5. Kernel Behavior Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-K-001 | Core | §5.1 | isCompoundExternal("spawn") returns true | Kernel classification query | `true` |
| SP-K-002 | Core | §5.1 | isCompoundExternal("join") returns true | Kernel classification query | `true` |
| SP-K-003 | Core | §5.1 | classify("spawn") returns EXTERNAL | Kernel classification query | `EXTERNAL` |
| SP-K-004 | Core | §5.1 | classify("join") returns EXTERNAL | Kernel classification query | `EXTERNAL` |
| SP-K-005 | Core | §5.2 | Spawn descriptor has id "spawn" and kernel suspends | Kernel evaluates `Eval("spawn", Quote({body}))` | Yields descriptor with `id: "spawn"` and suspends; descriptor data contains the unquoted body expression and the current environment. Internal field naming of the data payload follows the spec pseudocode but is verified by the runtime's ability to process the descriptor, not by exact field comparison |
| SP-K-006 | Core | §5.2 | Kernel resumes with runtime-provided task handle | After spawn descriptor yield, runtime provides handle value | Kernel returns the handle value |
| SP-K-007 | Core | §5.3 | Join descriptor has id "join" and kernel suspends | Kernel evaluates `Eval("join", Ref("t"))` with handle in env | Yields descriptor with `id: "join"` and suspends; descriptor data contains the unquoted Ref and the current environment. Internal field naming follows the spec pseudocode but is verified by runtime processing, not exact field comparison |
| SP-K-008 | Core | §5.3 | Kernel resumes with runtime-provided child result | After join descriptor yield, runtime provides value | Kernel returns the value |
| SP-K-009 | Core | §5.4 | Kernel does not create child tasks | Observe kernel behavior during spawn evaluation | Kernel yields descriptor only; no child task creation observable |
| SP-K-010 | Core | §5.4 | Kernel does not resolve task handles | Observe kernel behavior during join evaluation | Kernel yields descriptor only; no handle resolution observable |

---

## 6. Runtime Lifecycle Tests

### 6.1 Spawn Entry and Task Handle

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-R-001 | Core | R1 | Child coroutineId allocated deterministically | Parent spawns one child | Child coroutineId = `child_id(parent_id, 0)` |
| SP-R-002 | Core | R1 | Second spawn gets next childSpawnCount | Parent spawns two children | First child = `child_id(parent_id, 0)`, second = `child_id(parent_id, 1)` |
| SP-R-003 | Core | R1 | Spawn shares childSpawnCount with scope/all/race | Parent runs `scoped(...)` (index 0) then `spawn(...)` | Spawned child = `child_id(parent_id, 1)` |
| SP-R-004 | Extended | R2 | Task handle is joinable for the correct child | Parent spawns child; binds handle; joins handle | Join waits for the spawned child (verified by child coroutineId in journal events matching the expected deterministic ID); handle internal representation is implementation-defined |
| SP-R-005 | Core | R4 | Parent resumes immediately after spawn | Parent spawns child, then executes next statement | Parent's next statement executes before child completes; parent yieldIndex advances |

### 6.2 Join

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-R-010 | Core | R6, R7 | Join waits for child ok completion | Child returns 42 after one agent call | Parent resumes with value 42 |
| SP-R-011 | Core | R6, R7 | Join produces child's return value | Child returns `{ result: "patch" }` | Parent receives `{ result: "patch" }` |
| SP-R-012 | Core | R6 | Join does not advance parent yieldIndex | Parent at yieldIndex K before join | After join, parent resumes at yieldIndex K (no YieldEvent for join) |
| SP-R-013 | Core | R6 | Join does not produce YieldEvent | Full journal inspection after spawn+join workflow | No YieldEvent with id "join" or associated with join operation |
| SP-R-014 | Core | R8 | Duplicate join fails | Parent joins same task handle twice | Runtime invariant error; not an authored-language exception |
| SP-R-015 | Extended | R7 | Join on failed child is unreachable under MVP semantics | Construct IR where join descriptor reaches runtime for a child whose Close(err) has already been observed | Runtime produces invariant error; this path is unreachable in normal authored execution because child failure tears down the scope before the parent can advance to a join point. This test validates a defensive runtime check, not a normative authored-language behavior |

### 6.3 Concurrent Execution

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-R-020 | Core | R9, R10 | Parent yieldIndex advances concurrently with child | Parent spawns child, then makes two agent calls; child makes one agent call | Parent events at yieldIndex 0, 1 under parentId; child events at yieldIndex 0 under childId |
| SP-R-021 | Core | R11 | Child yieldIndex starts at 0 | Child makes one agent call | Child's first YieldEvent has yieldIndex 0 |
| SP-R-022 | Core | R9 | Multiple spawned children execute concurrently | Parent spawns two children; both make agent calls | Each child has independent events under its own coroutineId |

### 6.4 Fire-and-Forget

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-R-025 | Core | SP1, R16 | Fire-and-forget child completes before scope exits | Parent spawns (no binding), then returns value; child does work | Scope waits for child; child events appear in journal; parent Close after child Close |
| SP-R-026 | Core | SP1, R16 | Fire-and-forget child's result is discarded | Parent spawns (no binding), child returns 42 | Parent scope result is parent's own return value, not child's |

### 6.5 Parent Foreground Completion

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-R-030 | Core | R16 | Scope waits for spawned child before closing | Parent foreground completes; child still running | Parent Close appears only after child Close |
| SP-R-031 | Core | R17 | No parent events after foreground completion | Parent returns; child makes two more agent calls | No parent YieldEvents after parent's last foreground YieldEvent; child events continue |
| SP-R-032 | Core | R18 | Scope teardown runs after all children close | Parent returns; one child completes ok | Parent Close(ok) in journal after child Close(ok) |

---

## 7. Failure Propagation and Catchability Tests

### 7.1 Unconditional Failure Propagation

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-F-001 | Core | R12, R14 | Child failure tears down scope (child fails before parent reaches join) | Child throws immediately; parent has slow work before join | Scope tears down; parent Close(err) in journal |
| SP-F-002 | Core | R12, R14 | Child failure tears down scope (parent already waiting at join) | Parent reaches join first; child fails later | Scope tears down; parent Close(err) in journal; same outcome as SP-F-001 |
| SP-F-003 | Core | R12 | Fire-and-forget child failure tears down scope | No task handle bound; child throws | Scope tears down; parent Close(err) in journal |
| SP-F-004 | Core | R14 | Failure outcome identical regardless of interleaving | Run SP-F-001 and SP-F-002; compare final journal status | Both produce parent Close(err) with same error; observable outcome does not depend on scheduling |
| SP-F-005 | Core | R15 | Child Close(err) written before parent teardown begins | Child fails | Journal contains child Close(err) before parent Close(err); child Close(err) before sibling Close(cancelled) |
| SP-F-006 | Core | §10.2 T6 | Sibling children cancelled on child failure | Parent spawns two children; first child fails | First child: Close(err); second child: Close(cancelled); parent: Close(err) |
| SP-F-007 | Core | §10.2 T6 | Parent foreground cancelled on child failure | Parent doing slow work; child fails | Parent foreground does not complete; scope tears down |

### 7.2 Catchability Boundaries

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-F-010 | Core | R13a | Catch outside scoped(...) catches child failure | `try { yield* scoped(function*() { const t = yield* spawn(fn_throws); yield* t; }) } catch (e) { ... }` | Catch block executes; `e` is the child's error |
| SP-F-011 | Core | R13b | Catch around join point inside scope body does NOT catch child failure | `scoped(function*() { const t = yield* spawn(fn_throws); try { yield* t; } catch (e) { ... } })` | Catch block does NOT execute; scope tears down; error propagates to scope boundary |
| SP-F-012 | Core | R13b | Catch elsewhere inside scope body does NOT catch child failure | `scoped(function*() { yield* spawn(fn_throws); try { yield* agent.call(x); } catch (e) { ... } })` | Catch block does NOT execute; scope tears down; error propagates to scope boundary |
| SP-F-013 | Core | R13a, R13b | Catch outside scoped catches; catch inside does not | Combined: outer try/catch around scoped that has inner try/catch around join; child throws | Inner catch NOT reached; outer catch IS reached with child's error |
| SP-F-014 | Extended | R13a | Catch outside scoped with fire-and-forget child failure | `try { yield* scoped(function*() { yield* spawn(fn_throws); ... }) } catch (e) { ... }` | Outer catch block executes with child's error |

### 7.3 Parent Foreground Failure

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-F-020 | Core | §10.3 T10-T13 | Parent throw cancels spawned children | Parent throws after spawning child | Child: Close(cancelled); parent: Close(err) |
| SP-F-021 | Core | §10.3 T10 | All spawned children cancelled on parent throw | Parent spawns two children, then throws | Both children: Close(cancelled); parent: Close(err) |

### 7.4 External Cancellation

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-F-025 | Core | §10.4 T14-T16 | External cancellation cancels spawned children | Parent scope cancelled externally while child running | Child: Close(cancelled); parent: Close(cancelled) |
| SP-F-026 | Core | R19 | Cancellation via race propagates to spawned children | Parent inside race; sibling wins; parent had spawned child | Spawned child: Close(cancelled); parent: Close(cancelled) |

---

## 8. Journal Ordering Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-J-001 | Core | J2 | Per-coroutineId events in yieldIndex order | Parent and child each make multiple agent calls | Within each coroutineId, yieldIndex is strictly monotonic |
| SP-J-002 | Core | J3, T17 | Child Close before parent Close (success) | Parent spawns child; both complete ok | Ordering constraint: child Close before parent Close |
| SP-J-003 | Core | J3, T17 | Child Close before parent Close (child failure) | Child fails; parent tears down | Ordering constraint: child Close(err) before parent Close(err) |
| SP-J-004 | Core | J3a | Child Close(err) before sibling Close(cancelled) | Two children spawned; first fails | Ordering: first child Close(err) before second child Close(cancelled) |
| SP-J-005 | Core | J4 | Parent Close written after all children close | Parent foreground returns; child still running | Parent Close appears after child Close in journal |
| SP-J-006 | Core | J5 | No guaranteed cross-coroutineId Yield ordering | Parent and child produce YieldEvents | Test does NOT assert relative global position of parent vs child YieldEvents |
| SP-J-007 | Core | J6 | spawn does not produce YieldEvent | Parent spawns child | No YieldEvent with id "spawn" in parent's events; parent yieldIndex not advanced by spawn |
| SP-J-008 | Core | J7 | join does not produce YieldEvent | Parent joins child | No YieldEvent with id "join" in parent's events; parent yieldIndex not advanced by join |
| SP-J-009 | Core | J6, R10 | Parent yieldIndex skips spawn/join | Parent: spawn, agent call, join, agent call | Parent YieldEvents at indices 0, 1 (for agent calls only); no index consumed by spawn or join |
| SP-J-010 | Extended | J3, T17 | Multiple children all close before parent | Parent spawns three children | All three child Close events before parent Close |

---

## 9. Replay and Durability Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-RP-001 | Core | §8.1 | No new event types in journal | Full spawn+join workflow | Journal contains only YieldEvent and CloseEvent types |
| SP-RP-002 | Core | §8.2, RR1-RR4 | Replay reconstructs joinable handle for same child | Replay spawn workflow from journal | Child replays from its own journal events under the same deterministic coroutineId; parent join at replay produces the same child return value as the original run. Handle reconstruction is verified through join behavior, not handle internal representation |
| SP-RP-003 | Core | §8.3, RR6 | Per-coroutineId replay cursors operate independently | Parent and child both have journal events | Each replays from its own cursor; no cross-coroutineId cursor dependency |
| SP-RP-004 | Core | RR5 | Child with complete journal replays without live dispatch | Child completed in original run | On replay, child produces identical events from journal; no live dispatch |
| SP-RP-005 | Core | RR5 | Child with partial journal transitions to live | Child journal truncated mid-execution | Child replays available entries, then continues live |
| SP-RP-006 | Core | RR5 | Child with empty journal begins live execution | No child events in journal (crash before first yield) | Child starts fresh live execution |
| SP-RP-007 | Core | RR7 | Join resumes from child Close(ok) during replay | Child Close(ok, value) in replay index | Parent kernel resumes with value at join point |
| SP-RP-008 | Core | RR7 | Join for failed child replays as scope teardown | Child Close(err) in replay index | Scope teardown replays; parent never advances past join |
| SP-RP-009 | Core | RR8 | Parent waits at join until child terminal state known | Partial child journal; no Close in replay index | Parent replay cursor blocked at join until child reaches terminal state |
| SP-RP-010 | Core | RR9 | Duplicate join detection on replay | Parent replays two joins for same child coroutineId | Runtime invariant error; identical behavior to live execution (SP-R-014) |
| SP-RP-011 | Core | §8.5 | Replay produces identical result for success case | Complete spawn+join journal | Replay output matches original: same values, same per-coroutineId events |
| SP-RP-012 | Core | §8.5 | Replay produces identical result for failure case | Complete journal with child failure | Replay output matches original: same error, same Close events |
| SP-RP-013 | Core | R1, §8.5 | CoroutineId allocation is identical on replay | Replay spawn workflow | All coroutineIds match original run (deterministic from childSpawnCount) |

### 9.1 Crash Recovery Scenarios

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-RP-020 | Core | §8.6 | Crash before spawn: full re-execution | Empty journal | Parent re-executes; spawn occurs live; fresh handle and child |
| SP-RP-021 | Core | §8.6 | Crash after spawn, child in progress | Parent events through spawn; partial child events | Parent replays past spawn with fresh handle; child replays its events; join waits for child |
| SP-RP-022 | Core | §8.6 | Crash after join, child completed | Full parent and child journals including Close | Full replay to completion; same result |
| SP-RP-023 | Extended | §8.6 | Crash with multiple children at different progress points | Two children: one complete, one partial | Complete child replays fully; partial child replays then transitions to live |

---

## 10. Explicit Non-Tests (Deferred Coverage)

The following tests are explicitly NOT included in this plan.
They correspond to deferred extensions in spawn specification
§11 and would validate behavior outside the MVP.

| ID | Deferred Item | Spec ref | Why excluded |
|---|---|---|---|
| SP-NT-001 | Per-child error catching at join: `try { yield* task } catch (e)` inside scope body catches child error | §11.5 | Requires schedule-aware failure delivery; MVP propagates unconditionally |
| SP-NT-002 | Detached child outlives parent scope | §11.1 | Violates structured concurrency model |
| SP-NT-003 | spawn carries handler/binding metadata | §11.2 | Not supported; child uses nested scoped for own middleware |
| SP-NT-004 | resource(...) value provision from spawned child | §11.3 | Separate specification |
| SP-NT-005 | Task handle passed as agent call argument | §11.7, SP4 | SP4 rejects; future relaxation deferred |
| SP-NT-006 | Task handle returned from workflow | §11.7, SP4 | SP4 rejects; future relaxation deferred |
| SP-NT-007 | spawn inside setup prefix of scoped block | §11.6, SP7 | SP7 rejects; future relaxation deferred |
| SP-NT-008 | Stream iteration with nested spawn | §11.4 | Requires iteration primitives not yet specified |
| SP-NT-009 | Buffered or schedule-aware failure routing | §11.5 | Future amendment; MVP uses unconditional propagation |

---

## 11. Inheritance Tests

These tests validate that spawned children correctly inherit
transport bindings and enforcement wrappers from the parent
scope, as specified in §3.5–3.6.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SP-I-001 | Core | SP12 | Spawned child dispatches to parent-bound agent | Parent scope has `useTransport(A, t)`; spawned child calls `yield* useAgent(A)` then `yield* h.method(x)` | Child's agent call routes through parent's transport; effect dispatched successfully |
| SP-I-002 | Core | SP12 | Spawned child dispatches to multiple parent-bound agents | Parent scope binds two contracts; child uses both | Both dispatches route correctly |
| SP-I-003 | Core | SP13 | Parent enforcement wrapper applies to spawned child | Parent has `Effects.around` that modifies effect data; child dispatches effect | Child's effect passes through parent's middleware; modified data observed |
| SP-I-004 | Core | SP13 | Parent enforcement wrapper is non-bypassable in child | Child does not install own middleware; parent middleware active | All child effects pass through parent wrapper |
| SP-I-005 | Core | SP14 | Nested scoped inside spawned body extends middleware | Spawned body contains `scoped(...)` with own `Effects.around` | Inner scope's middleware composes with inherited parent middleware |
| SP-I-006 | Core | SP14 | Nested scoped inside spawned body shadows transport | Spawned body contains `scoped(...)` with `useTransport(A, t2)` for same contract | Inner scope uses t2; outer spawned body uses parent's t1 |
| SP-I-007 | Core | SP15 | Inheritance observable regardless of concurrency substrate | Spawned child agent call produces YieldEvent with correctly routed effect | Effect data in journal matches expected transport routing |

---

## 12. Coverage Summary

### 12.1 Specification Sections Covered

| Spec section | Test category | Test IDs |
|---|---|---|
| §3.1 Accepted Form | Compiler acceptance/rejection | SP-C-001–002, SP-C-020–024 |
| §3.2 Return Value and Binding (SP1–SP2) | Compiler acceptance/rejection | SP-C-001–002, SP-C-024 |
| §3.3 Spawn Handle Join (SP3–SP6) | Compiler acceptance/rejection | SP-C-003–006, SP-C-040–045 |
| §3.4 Placement (SP7–SP8) | Compiler acceptance/rejection | SP-C-007–009, SP-C-030–031 |
| §3.5 Spawned Body Rules (SP9–SP11) | Compiler + Inheritance | SP-C-010–013, SP-C-050–055, SP-I-001–007 |
| §3.6 Middleware Inheritance (SP12–SP15) | Inheritance | SP-I-001–007 |
| §4 IR Forms | IR lowering | SP-IR-001–007 |
| §5 Kernel Evaluation | Kernel behavior | SP-K-001–010 |
| §6.1 Spawn Entry (R1–R4) | Runtime lifecycle | SP-R-001–005 |
| §6.2 Join (R5–R8) | Runtime lifecycle | SP-R-010–015 |
| §6.3 Concurrent Execution (R9–R11) | Runtime lifecycle | SP-R-020–022 |
| §6.4 Failure Propagation (R12–R15, R13a–R13c) | Failure + Catchability | SP-F-001–014 |
| §6.5 Parent Foreground Completion (R16–R18) | Runtime lifecycle | SP-R-025–026, SP-R-030–032 |
| §6.6 Cancellation (R19–R21) | Failure | SP-F-025–026 |
| §7 Journal Ordering (J1–J7, J3a) | Journal ordering | SP-J-001–010 |
| §8 Replay and Durability (RR1–RR9) | Replay | SP-RP-001–023 |
| §10 Teardown (T1–T19) | Failure + Journal ordering | SP-F-005–007, SP-F-020–021, SP-J-002–005 |
| §11 Deferred Extensions | Explicit non-tests | SP-NT-001–009 |

### 12.2 Deferred Sections Intentionally Excluded

| Spec section | Reason |
|---|---|
| §11.1 Detached tasks | Out of scope |
| §11.2 Spawn with setup | Not supported in MVP |
| §11.3 resource(...) | Separate specification |
| §11.4 Stream consumption | Requires unspecified primitives |
| §11.5 Per-child error catching at join | Schedule-sensitive; deferred |
| §11.6 Spawn in setup prefix | Not supported in MVP |
| §11.7 Handle passing | Not supported in MVP |

### 12.3 Test Counts

| Category | Core | Extended | Total |
|---|---|---|---|
| A. Compiler acceptance | 15 | 2 | 17 |
| A. Compiler rejection | 13 | 2 | 15 |
| B. IR lowering | 6 | 1 | 7 |
| C. Kernel behavior | 10 | 0 | 10 |
| D. Runtime lifecycle | 17 | 2 | 19 |
| E. Failure + Catchability | 15 | 1 | 16 |
| F. Journal ordering | 9 | 1 | 10 |
| G. Replay + Durability | 16 | 1 | 17 |
| H. Inheritance | 7 | 0 | 7 |
| **Total** | **108** | **10** | **118** |

Explicit non-tests: 9

---

## Appendix A: Open Testing Notes

> **Non-normative.** These notes identify harness support or
> implementation spikes that may help execute this plan without
> weakening the normative scope of the tests.

### A.1 Concurrency Scheduling Control

Tests SP-F-001 and SP-F-002 require demonstrating that the
failure outcome is schedule-independent. Two approaches:

- **Approach A:** Run the same IR with deliberately different
  scheduling orders (parent-first vs child-first) and compare
  final journal status. This requires a controllable scheduler
  or deterministic Effection task ordering.
- **Approach B:** Construct fixtures where the parent is
  provably at the join vs provably not at the join (using
  agent call latency differences), and verify the same error
  outcome in both cases.

SP-F-004 is the explicit comparison test. Its implementation
depends on which approach the harness supports.

### A.2 Per-CoroutineId Journal Comparison

The spawn test harness needs journal comparison that operates
per-coroutineId rather than globally. The existing harness
compares a flat event sequence; spawn tests require:

- grouping events by coroutineId
- verifying yieldIndex monotonicity within each group
- verifying ordering constraints across groups (child Close
  before parent Close) without asserting global position

The `journal_ordering` field in the fixture schema supports
this via explicit `OrderingConstraint` entries.

### A.3 Interleaving Non-Determinism

Tests in §8 (Journal Ordering) explicitly state that global
interleaving order is NOT deterministic. The harness MUST NOT
compare global event positions for parent vs child YieldEvents.
SP-J-006 exists specifically to verify this non-assertion.

### A.4 Catchability Test Harness

Tests SP-F-010 through SP-F-014 require observing whether a
catch block executed. The recommended approach is to have the
catch block produce a distinguishable side effect (e.g., an
agent call with a marker effect ID) and verify its presence
or absence in the journal.

- SP-F-010: marker effect present → catch block executed
- SP-F-011: marker effect absent → catch block did NOT execute
- SP-F-012: marker effect absent → catch block did NOT execute
- SP-F-013: inner marker absent, outer marker present

### A.5 Unreachable Invariant Paths

SP-R-015 tests a defensive runtime check for a path that is
unreachable under normal MVP semantics: joining a child that
has already failed. Under the schedule-independent failure
rule (§6.4), child failure tears down the parent scope before
the parent can reach a join point. The test is classified as
Extended because it validates implementation defensiveness,
not authored-language behavior. It requires constructing IR
or runtime state that bypasses the normal scope-teardown
pathway.

Similarly, the "runtime invariant error" in R7 for joining a
failed/cancelled child is a defensive check. Conformance
suites MAY validate this path for implementation quality but
MUST NOT classify it as a Core conformance failure if the
runtime prevents the path from being reached through correct
scope teardown.

### A.6 Task Handle Opacity

The spawn specification §4.3 defines a specific runtime
representation for the task handle:
`{ __tisyn_task: childCoroutineId }`. This is guidance for
implementors. The conformance plan does not require exact
structural comparison of handle values because the handle is
an opaque capability value (§2) — its internal shape is not
observable through authored-language mechanisms.

SP-R-004 (Extended) tests that the handle correctly
identifies its child, but verifies this through join behavior
and journal coroutineId matching rather than handle field
inspection. Implementations MAY use any internal
representation that satisfies the join and replay semantics.
