# Tisyn Stream Iteration — Conformance Test Plan

**Version:** 0.1.0  
**Tests:** Tisyn MVP Stream Iteration Specification 0.1.0  
**Status:** Draft

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the MVP
stream-iteration feature as specified in the Tisyn MVP Stream
Iteration Specification v0.1.0. It covers:

- compiler acceptance and rejection of the constrained
  `for (const x of yield* each(s)) { ... }` form per §4
- IR lowering shape and compiler-generated synthetic bindings
  per §7
- runtime handling of `stream.subscribe` and `stream.next`
  external effects per §8 and §10
- capability-value restrictions and escape rejection per §6
- replay behavior for journaled stream effects per §9
- live-frontier transition behavior per §9.3
- cancellation and scope-bound teardown per §10.2
- explicit non-tests for deferred or out-of-scope behavior
  per §3.3 and §13.4

### 1.2 What This Plan Does Not Cover

The following are explicitly outside the scope of this test
plan. They correspond to the non-goals listed in stream
iteration specification §3.3.

- exact resumable cursor-based recovery (NG3)
- general `for...of` compilation (NG1)
- user-authored `each.next()` runtime behavior (NG2; compiler
  rejection IS tested)
- exactly-once item processing guarantees (NG4)
- continue-as-new or journal compaction (NG5)
- fan-out or multi-subscriber streams (NG6)
- stream transformation operators (NG7)
- nested `for yield* each` runtime behavior (NG8; compiler
  rejection IS tested)
- destructuring in the `for` binding runtime behavior (NG9;
  compiler rejection IS tested)
- lossless delivery from volatile push sources across crash
  boundaries (§14.4)
- exact item identity across crash/replay boundaries (§14.4)
- performance benchmarks

Tests that would validate deferred behavior are listed in §11
(Explicit Non-Tests) for tracking purposes.

### 1.3 MVP Framing

This test plan preserves the approved MVP framing: stream
iteration is a constrained iteration facility, not a general
durable stream abstraction. Tests in §9 (Replay / Live-
Frontier) treat duplicate-prone and lossy-but-allowed
outcomes as expected conforming behavior where the spec says
so. No test encodes stronger replay guarantees than the spec
provides.

### 1.4 Observability Model

All tests compare observable outputs only:

- **Compiler tests:** acceptance (produces conforming IR) or
  rejection (produces a diagnostic identifying the violated
  constraint). Diagnostics are compared by violated-rule
  category (e.g., `E-STREAM-001`, `SI1`), not by message
  wording.
- **Runtime tests:** result value, result status, and journal
  event sequence. Journal events are compared using canonical
  JSON equality per the existing conformance harness.
- **Replay tests:** journal event sequence after replay
  matches the expected sequence. Live-frontier behavior is
  verified by observing the first live `YieldEvent` after
  replayed entries.

No test depends on implementation internals, intermediate
compiler state, runtime step ordering beyond normative
ordering constraints, or the internal representation of
opaque capability values such as subscription handles.

### 1.5 Tiers

**Core:** Tests that every conforming implementation MUST
pass. An implementation is non-conforming if any Core test
fails.

**Extended:** Tests for edge cases, boundary conditions, and
diagnostic quality. Recommended but not required for initial
conformance.

---

## 2. Fixture Schema

### 2.1 Compiler Acceptance Fixture

````typescript
interface StreamCompilerAcceptanceFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "compiler_acceptance";
  source: string;
  expected_ir_shape: {
    has_subscribe: boolean;    // stream.subscribe Eval present
    has_next: boolean;         // stream.next Eval present
    has_recursive_fn: boolean; // Fn containing Call to itself
    binding_identifier: string; // authored loop variable name
    synthetic_names: string[]; // expected __sub_N, __loop_N, etc.
  };
}
````

### 2.2 Compiler Rejection Fixture

````typescript
interface StreamCompilerRejectionFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "compiler_rejection";
  source: string;
  violated_rule: string;       // e.g. "E-STREAM-001", "SI1"
}
````

> **Note:** `violated_rule` identifies the constraint from §4
> of the stream iteration spec. The test verifies that the
> compiler rejects the source and that the diagnostic
> references the correct constraint category. Exact error code
> numbers and message wording are not compared — only the
> violated-rule family (e.g., `E-STREAM-001` matches if the
> diagnostic identifies the `E-STREAM-001` category, regardless
> of the prose message). This follows the diagnostic comparison
> model established by the blocking-scope test plan §2.2.

### 2.3 Runtime Effect Fixture

````typescript
interface StreamRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "stream_runtime";
  ir: Expr;                    // hand-constructed IR
  env: Record<string, Val>;
  mock_stream: {               // mock Effection stream
    items: Val[];              // items to produce
    error?: string;            // optional error after items
  };
  expected: {
    status: "ok" | "err" | "cancelled";
    value?: Val;
    error?: { message?: string; name?: string };
    journal: Array<YieldEntry | CloseEntry>;
  };
}
````

### 2.4 Replay Fixture

````typescript
interface StreamReplayFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "stream_replay";
  ir: Expr;
  env: Record<string, Val>;
  stored_journal: DurableEvent[];
  mock_stream: {               // source for live-frontier items
    items: Val[];
    error?: string;
  };
  source_class: "idempotent" | "volatile";
  recovery_classification:
    | "conforming"
    | "duplicate-prone"
    | "lossy-but-allowed";
  expected: {
    status: "ok" | "err";
    value?: Val;
    journal: Array<YieldEntry | CloseEntry>;
    live_effects_count: number; // number of effects dispatched live
  };
}
````

### 2.5 Negative Runtime Fixture

````typescript
interface StreamNegativeRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "negative_runtime";
  ir: Expr;
  env: Record<string, Val>;
  expected_error: {
    name?: string;
    message_contains?: string;
  };
}
````

---

## 3. Compiler Acceptance Tests

### 3.1 Valid `for yield* each(...)` Forms

| ID | Tier | Rule | Description | Source shape | Expected IR shape |
|---|---|---|---|---|---|
| SI-C-001 | Core | §4.3 SI1–SI3 | Minimal valid loop with one body effect | `for (const x of yield* each(source)) { yield* A().op(x); }` | subscribe + Fn with next + If + body Eval + recursive Call |
| SI-C-002 | Core | §4.3 SI3 | Empty loop body | `for (const x of yield* each(source)) { }` | subscribe + Fn with next + If + discard(null) + recursive Call |
| SI-C-003 | Core | §7.5 | Loop followed by continuation | `for (const x of yield* each(s)) { yield* A().op(x); } return 42;` | Let(__discard_N, Call(__loop_N), 42) |
| SI-C-004 | Core | §7.5 | Loop body contains `return` | `for (const x of yield* each(s)) { if (x.done) { return x.result; } yield* A().op(x); }` | outcome packing: __tag/__value Construct, dispatch If |
| SI-C-005 | Core | §4.3 SI2 | Source expression is property access | `for (const x of yield* each(src.events())) { yield* A().op(x); }` | subscribe data = Get(Ref("src"), "events") call result |
| SI-C-006 | Core | §4.3 SI3 | Body contains if/else with effects in both branches | `for (const x of yield* each(s)) { if (x.type === "a") { yield* A().handleA(x); } else { yield* A().handleB(x); } }` | If node inside loop body, recursive Call after both paths |
| SI-C-007 | Core | §4.3 | Loop inside `scoped(...)` body | `yield* scoped(function*() { yield* useTransport(S, t); const src = yield* useAgent(S); for (const x of yield* each(src.events())) { yield* A().op(x); } });` | scope node body contains stream lowering |
| SI-C-008 | Core | §4.3 | Loop inside `spawn(...)` body | `yield* spawn(function*() { for (const x of yield* each(source)) { yield* A().op(x); } });` | spawn node body contains stream lowering |
| SI-C-009 | Extended | §4.3 SI2 | Source expression is function call | `for (const x of yield* each(makeSource(config))) { yield* A().op(x); }` | subscribe data includes compiled call expression |
| SI-C-010 | Extended | §4.3 SI3 | Body contains try/catch around effects | `for (const x of yield* each(s)) { try { yield* A().op(x); } catch (e) { yield* A().logError(e); } }` | Try node inside loop body |

---

## 4. Compiler Rejection Tests

### 4.1 Binding Violations

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-020 | Core | SI1, E-STREAM-001 | `let` binding | `for (let x of yield* each(s)) { yield* A().op(x); }` | E-STREAM-001 |
| SI-C-021 | Core | SI1, E-STREAM-002 | Destructuring binding | `for (const {a, b} of yield* each(s)) { yield* A().op(a); }` | E-STREAM-002 |
| SI-C-022 | Extended | SI1, E-STREAM-002 | Array destructuring binding | `for (const [a, b] of yield* each(s)) { yield* A().op(a); }` | E-STREAM-002 |

### 4.2 `each(...)` Usage Violations

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-030 | Core | E-STREAM-003 | Missing `yield*` | `for (const x of each(s)) { yield* A().op(x); }` | E-STREAM-003 |
| SI-C-031 | Core | E-STREAM-004 | `each()` outside `for...of` | `const sub = yield* each(source);` | E-STREAM-004 |
| SI-C-032 | Core | E-STREAM-004 | `each()` as bare statement | `yield* each(source);` | E-STREAM-004 |

### 4.3 `each.next()` Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-040 | Core | SI4, E-STREAM-005 | `each.next()` inside loop body | `for (const x of yield* each(s)) { yield* A().op(x); yield* each.next(); }` | E-STREAM-005 |
| SI-C-041 | Core | SI4, E-STREAM-005 | `each.next()` as standalone statement | `yield* each.next();` | E-STREAM-005 |
| SI-C-042 | Extended | SI4, E-STREAM-005 | `each.next()` inside if branch | `for (const x of yield* each(s)) { if (true) { yield* each.next(); } }` | E-STREAM-005 |

### 4.4 General `for...of` Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-050 | Core | E013 | General `for...of` with non-each iterable | `for (const x of yield* someOtherFn(s)) { }` | E013 |
| SI-C-051 | Core | E013 | `for...of` with array literal | `for (const x of [1, 2, 3]) { }` | E013 |

### 4.5 Control Flow Violations

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-060 | Core | E020 | `break` inside loop body | `for (const x of yield* each(s)) { break; }` | E020 |
| SI-C-061 | Core | E020 | `continue` inside loop body | `for (const x of yield* each(s)) { continue; }` | E020 |

### 4.6 Nesting Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SI-C-070 | Core | E-STREAM-006 | Nested `for yield* each` | `for (const x of yield* each(s1)) { for (const y of yield* each(s2)) { yield* A().op(y); } }` | E-STREAM-006 |

---

## 5. Lowering Invariants

Compiler acceptance tests MUST verify the following structural
invariants on the output IR. These invariants are checked by
structural inspection of the compiled output, not by runtime
execution.

| ID | Tier | Rule | Invariant |
|---|---|---|---|
| SI-L-001 | Core | §7.2 | Output IR contains exactly one `Eval` with id `"stream.subscribe"` per accepted loop |
| SI-L-002 | Core | §7.2 | Output IR contains exactly one `Eval` with id `"stream.next"` inside a `Fn` body |
| SI-L-003 | Core | §7.2 | A `Call(Ref("__loop_N"), [])` appears at the end of the else-branch of the `If(Get(..., "done"), ...)` node |
| SI-L-004 | Core | §7.2 | Synthetic names `__sub_N`, `__loop_N`, `__item_N` are bound by `Let` before any `Ref` to them |
| SI-L-005 | Core | §7.3 | The `stream.subscribe` Eval's data contains the compiled source expression |
| SI-L-006 | Core | §7.3 | The `stream.next` Eval's data contains `Ref("__sub_N")` |
| SI-L-007 | Core | §7.3 | The authored loop variable is bound via `Let("<identifier>", Get(Ref("__item_N"), "value"), ...)` |
| SI-L-008 | Core | §7.6 | Loop as last statement: call site is `Call(Ref("__loop_N"), [])` directly |
| SI-L-009 | Core | §7.6 | Loop with continuation: call site is `Let("__discard_N", Call(...), ⟦continuation⟧)` |
| SI-L-010 | Core | §7.5 | Loop body with `return`: Fn produces `Construct({ __tag: "return", __value: ... })` on return path |
| SI-L-011 | Extended | §4.3 SI4 | No `each.next` identifier survives into the output IR in any form |

---

## 6. Runtime Conformance Tests

These tests use hand-constructed IR (not compiled source) to
verify runtime behavior independently of the compiler. They
provide a mock Effection stream source and compare result,
status, and journal.

### 6.1 Subscription Lifecycle

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-R-001 | Core | R1, §8.1 | `stream.subscribe` returns handle | IR: single `Eval("stream.subscribe", [sourceDef])` | YieldEvent with description `{type:"stream", name:"subscribe"}`, result contains `__tisyn_subscription` field |
| SI-R-002 | Core | R1 | Handle token is deterministic | Same IR executed twice with same coroutineId | Same handle token in both executions |
| SI-R-003 | Core | R3, §8.2 | `stream.next` returns item | IR: subscribe then `Eval("stream.next", [handle])` with mock source producing `[10, 20]` | First next → `{done:false, value:10}`, second → `{done:false, value:20}` |
| SI-R-004 | Core | R3 | Stream exhaustion returns done | Mock source produces `[10]` then closes | Third next (after two items) → `{done:true}` |
| SI-R-005 | Core | §8.2 | Stream error produces err YieldEvent | Mock source errors after first item | YieldEvent for next with `status:"err"` |

### 6.2 Full Iteration

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-R-010 | Core | §7.2 | Complete loop over 3 items | Hand-constructed recursive Fn+Call IR; mock source `[1,2,3]` | 3 subscribe yields (1 subscribe + 3 next + 3 body effects) + final next(done) + close(ok, null) |
| SI-R-011 | Core | §7.5 | Loop followed by continuation | IR: loop then literal 42; mock source `[1]` | close(ok, 42) |
| SI-R-012 | Core | §7.5 | Early return from loop body | IR with return-packing; source `[1,2,3]`; return when value=2 | close(ok, 2); items 3+ never fetched |

### 6.3 Cancellation and Teardown

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-R-020 | Core | R7 | Cancellation during in-flight `stream.next` | Halt parent scope while `stream.next` is suspended | Close(cancelled); no YieldEvent for the in-flight next |
| SI-R-021 | Core | R6 | Teardown on scope exit after normal completion | Mock source with 2 items; loop completes normally | Subscription torn down; subsequent effects in scope do not observe subscription |
| SI-R-022 | Core | R6 | Teardown on scope exit after error | Body effect throws error | Subscription torn down; Close(err) |

---

## 7. Capability-Value Conformance Tests

All tests in this section use **hand-constructed IR**, not
compiled source. This is intentional: for compiled authored
code, the compiler controls the subscription handle's entire
lifecycle via synthetic names (`__sub_N`) that never appear
in the authored source. The author cannot observe, reference,
or misuse the handle because it does not exist in the
authored language. Escape is structurally impossible in
compiled code, so no compiler-surface capability test is
needed or possible.

The runtime enforcement rules (RV1–RV3) apply only to
hand-constructed IR where the handle IS user-visible. The
tests below verify that the runtime correctly rejects
invalid capability escape in this context.

### 7.1 Permitted Usage (Hand-Constructed IR)

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-V-001 | Core | §6.3 | Handle bound via Let and referenced via Ref | Hand-constructed IR: Let(handle, subscribe, Let(item, next(handle), ...)) | Normal execution; handle resolves correctly |
| SI-V-002 | Core | §6.3 | Handle captured in spawned child via Ref | Hand-constructed IR: subscribe in parent, stream.next in spawned child referencing parent's handle binding | Normal execution; child accesses parent subscription |

### 7.2 Rejected Usage (Runtime Enforcement)

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-V-010 | Core | RV2 | Handle in agent effect data | Hand-constructed IR: `Eval("agent.op", [handle])` | Runtime error; effect rejected |
| SI-V-011 | Core | RV3 | Handle as workflow return value | Hand-constructed IR: body returns the handle directly | Runtime error; Close value rejected |
| SI-V-012 | Core | RV2 | Handle embedded in Construct | Hand-constructed IR: `Construct({ task: handle })` passed as effect data | Runtime error; effect rejected |
| SI-V-013 | Extended | RV1 | Handle used from unrelated coroutineId | Hand-constructed IR: handle created in one coroutine, `stream.next` dispatched from a non-ancestor coroutine | Runtime error; ancestry check fails |

### 7.3 Replay Reconstruction

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-V-020 | Core | §6.6 | Handle reconstructed on replay | Stored journal with subscribe + 2 next items; replay | Replayed handle token matches stored handle; no Effection subscription created during replay |
| SI-V-021 | Core | §6.6 | Reconstructed handle resolves in subsequent next | Stored journal with subscribe + 1 next; second next hits live frontier | Handle from replay is usable for live subscription creation |

---

## 8. Replay / Live-Frontier Conformance Tests

These tests are the most important section. They verify the
replay model defined in §9 without encoding stronger
guarantees than the spec provides.

> **Over-test guard.** Stronger replay guarantees than those
> defined in the MVP stream-iteration spec MUST NOT be
> treated as required conformance. Specifically:
>
> - No test MAY assert that the first live item after replay
>   is the "next" item in any source-defined sequence. The
>   spec guarantees only that *journaled* items replay
>   exactly; what the fresh subscription produces at the live
>   frontier is source-determined and outside Tisyn's control.
> - No test MAY assert lossless delivery from volatile push
>   sources across a crash boundary.
> - No test MAY assert that duplicate re-delivery does not
>   occur for idempotent-resubscribe sources.
> - No test MAY assert cursor-based resumption.
>
> Tests that accidentally encode any of these properties are
> non-conforming with this test plan.

### 8.1 Pure Replay (No Live Frontier)

| ID | Tier | Rule | Description | Stored journal | Expected |
|---|---|---|---|---|---|
| SI-D-001 | Core | §9.2, RT3 | Replay of subscribe + 3 items + done + close | Full journal: subscribe, 3 next(value), 1 next(done), close(ok) | Replay produces identical result; no live effects dispatched; `live_effects_count = 0` |
| SI-D-002 | Core | §9.2, RT3 | Replay of subscribe + 2 items + error | Journal: subscribe, 2 next(value), 1 next(err), close(err) | Replay produces identical error; no live dispatch |
| SI-D-003 | Core | §9.2 | Replay verifies description matching | Journal with `{type:"stream", name:"next"}`; IR produces same effect | CASE 1 match; replayed value returned |
| SI-D-004 | Core | §9.2 | Replay divergence on description mismatch | Journal with `{type:"stream", name:"subscribe"}`; IR produces `{type:"agent", name:"op"}` | DivergenceError |

### 8.2 Live-Frontier Transition

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-D-010 | Core | §9.3 R5 | First live `stream.next` creates subscription | Stored: subscribe + 2 items; mock source ready | Replay items 0-1; item 2 dispatched live from mock source; `live_effects_count ≥ 1` |
| SI-D-011 | Core | §9.3 | Subsequent live `stream.next` uses existing subscription | Stored: subscribe + 1 item; mock source produces 3 items | 1 replayed, 3 live; all 3 live items journaled |
| SI-D-012 | Core | §9.3 | Live frontier produces done signal | Stored: subscribe + 2 items; mock source exhausted (0 more items) | 2 replayed; live next returns done; loop exits normally |
| SI-D-013 | Core | §9.3 | Live frontier with body effects | Stored: subscribe + 2 items + 2 body effects; mock source produces 1 more item | 2 items + 2 body effects replayed; item 3 + body effect 3 dispatched live |

### 8.3 Source-Class Recovery Behavior

These tests verify that the recovery classifications from
§9.4–9.6 are treated as expected conforming behavior, not as
failures.

| ID | Tier | Rule | Description | Recovery classification | Verification |
|---|---|---|---|---|---|
| SI-D-020 | Core | §9.5 | Idempotent source re-delivers after replay | `duplicate-prone` | Stored: subscribe + 2 items; mock source restarts from item 0 on resubscribe; item 0 is the first live item; test passes (this is conforming, not an error) |
| SI-D-021 | Core | §9.6 | Volatile source skips crash-window items | `lossy-but-allowed` | Stored: subscribe + 2 items; mock source produces item 5 on resubscribe (items 3-4 lost); test passes (this is conforming, not an error) |
| SI-D-022 | Core | §9.8 | Clean transition after N items | `conforming` | Stored: subscribe + 5 items + 5 body effects; mock source produces item 5; replay transitions cleanly; item 5 journaled live |

### 8.4 At-Least-Once Delivery

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SI-D-030 | Core | §13.2 NG2 | Body re-executes for last pre-crash item | Stored: subscribe + next(item2) but NO body effect for item2; mock source for live body dispatch | Body effect for item2 dispatches live (re-execution); this is at-least-once, not a failure |

---

## 9. Journal Invariant Tests

These tests verify journal-level properties that the spec
requires.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| SI-J-001 | Core | G1 | stream.next YieldEvent written before kernel resumes | Journal append count advances before next kernel step |
| SI-J-002 | Core | L4 | stream.subscribe produces exactly one YieldEvent | One yield with description `{type:"stream", name:"subscribe"}` per loop |
| SI-J-003 | Core | L4 | stream.next produces exactly one YieldEvent per item | N items → N yields with description `{type:"stream", name:"next"}` |
| SI-J-004 | Core | L4 | Fn and Call produce no journal events | Total yields = 1 subscribe + N next + (body effects per iteration); no yields for structural operations |

---

## 10. Kernel Non-Change Verification

These tests confirm that the kernel requires no changes per
§12.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| SI-K-001 | Core | K1, §8.3 | `classify("stream.subscribe")` returns EXTERNAL | Classification check |
| SI-K-002 | Core | K1, §8.3 | `classify("stream.next")` returns EXTERNAL | Classification check |
| SI-K-003 | Core | K3 | `isCompoundExternal("stream.subscribe")` returns false | Not in compound-external set |
| SI-K-004 | Core | K3 | `isCompoundExternal("stream.next")` returns false | Not in compound-external set |
| SI-K-005 | Core | K1 | Kernel uses resolve path (not unquote) for stream effects | Descriptor data is fully resolved Val; no Expr nodes in data |

---

## 11. Explicit Non-Tests

The following tests are intentionally NOT part of this test
plan. They correspond to behavior deferred or excluded in
stream iteration specification §3.3 and §13.4.

| ID | Deferred item | Spec ref | Why not tested |
|---|---|---|---|
| SI-X-001 | Exact cursor-based recovery | NG3, NR1 | Not provided by MVP; would encode stronger guarantees |
| SI-X-002 | Lossless delivery from volatile sources | NG3, §14.4 | Not guaranteed; lossy-but-allowed is conforming |
| SI-X-003 | Exactly-once item processing | NG4, §13.2 NG2 | Not guaranteed; at-least-once is the contract |
| SI-X-004 | Nested `for yield* each` runtime behavior | NG8 | Compiler rejects; cannot reach runtime |
| SI-X-005 | Destructuring in `for` binding runtime | NG9 | Compiler rejects; cannot reach runtime |
| SI-X-006 | `each.next()` runtime behavior | NG2 | Compiler rejects; cannot reach runtime |
| SI-X-007 | General `for...of` runtime behavior | NG1 | Compiler rejects; cannot reach runtime |
| SI-X-008 | Stream transformation operators | NG7 | Not specified |
| SI-X-009 | Continue-as-new / journal compaction | NG5 | Not specified |
| SI-X-010 | Fan-out / multi-subscriber | NG6 | Not specified |
| SI-X-011 | Item identity across crash boundary | §14.4 | Not guaranteed by NR1 |
| SI-X-012 | Cursor-based resumption | §14.4 | Not provided by NG4 |
| SI-X-013 | Performance benchmarks | — | Not normative; conformance is functional, not performance-based |

> **Note:** SI-X-004 through SI-X-007 have corresponding
> rejection tests in §4 that verify the compiler rejects these
> forms. The non-tests here confirm that runtime behavior for
> these forms is not tested because they cannot reach runtime.

---

## 12. Conformance Exit Criteria

An implementation passes MVP stream-iteration conformance if
and only if:

1. All Core tier compiler acceptance fixtures produce IR
   conforming to the expected IR shape (§3) and satisfying
   the lowering invariants (§5).

2. All Core tier compiler rejection fixtures produce a
   diagnostic that identifies the violated constraint
   category.

3. All Core tier runtime effect fixtures produce the expected
   result status, result value (canonical JSON equality), and
   journal event sequence (canonical JSON equality per event).

4. All Core tier replay fixtures produce the expected result
   and journal sequence, with the correct number of live-
   dispatched effects.

5. All Core tier capability-value fixtures produce the
   expected acceptance or rejection behavior.

6. All Core tier kernel non-change fixtures confirm
   classification and resolution path behavior.

7. All Core tier journal invariant fixtures confirm persist-
   before-resume and event-count properties.

8. No Core tier fixture produces an unexpected error, hangs,
   or crashes.

Recovery-classification fixtures (§8.3) MUST treat
duplicate-prone and lossy-but-allowed outcomes as passing
results, not failures. Encoding stronger replay guarantees
than the spec provides is itself a conformance violation in
the test plan.

---

## 13. Coverage Summary

### 13.1 Spec Section Coverage

| Spec section | Test category | Test IDs | Status |
|---|---|---|---|
| §4.3 Accepted syntax (SI1–SI4) | Compiler acceptance | SI-C-001–010 | Covered |
| §4.4 Rejected syntax | Compiler rejection | SI-C-020–070 | Covered |
| §4.5 E010 interaction | Compiler acceptance | SI-C-001 (implicit) | Covered |
| §6.3–6.5 Capability restrictions | Capability conformance | SI-V-001–021 | Covered |
| §7.2 Lowered IR shape | Lowering invariants | SI-L-001–011 | Covered |
| §7.5–7.6 Post-loop / call site | Compiler acceptance | SI-C-003–004, SI-L-008–010 | Covered |
| §8.1–8.3 External effect surface | Runtime + kernel | SI-R-001–005, SI-K-001–005 | Covered |
| §9.1 Non-resumable recovery | Non-tests | SI-X-001, SI-X-011–012 | Explicitly excluded |
| §9.2 Replay mechanism | Replay | SI-D-001–004 | Covered |
| §9.3 Live-frontier transition | Replay | SI-D-010–013 | Covered |
| §9.4–9.6 Source-class recovery | Replay | SI-D-020–022 | Covered |
| §10.1 Subscription lifecycle | Runtime | SI-R-001–012 | Covered |
| §10.2 Scope-bound teardown | Runtime | SI-R-020–022 | Covered |
| §10.3 Capability enforcement | Capability conformance | SI-V-010–013 | Covered |
| §12 Kernel responsibilities | Kernel non-change | SI-K-001–005 | Covered |
| §13 MVP contract | Non-tests + recovery | SI-D-020–030, SI-X-001–012 | Covered |
| §14 Conformance hooks (CT1–CT4) | Compiler | SI-C-*, SI-L-* | Covered |
| §14 Conformance hooks (RT1–RT7) | Runtime | SI-R-*, SI-V-* | Covered |
| §14 Conformance hooks (RCT1–RCT5) | Replay + capability | SI-D-*, SI-V-010 | Covered |

### 13.2 Test Count Summary

| Category | Core | Extended | Total |
|---|---|---|---|
| Compiler acceptance | 8 | 2 | 10 |
| Compiler rejection — binding | 2 | 1 | 3 |
| Compiler rejection — each usage | 3 | 0 | 3 |
| Compiler rejection — each.next | 2 | 1 | 3 |
| Compiler rejection — general for...of | 2 | 0 | 2 |
| Compiler rejection — control flow | 2 | 0 | 2 |
| Compiler rejection — nesting | 1 | 0 | 1 |
| Lowering invariants | 10 | 1 | 11 |
| Runtime lifecycle | 5 | 0 | 5 |
| Runtime full iteration | 3 | 0 | 3 |
| Runtime cancellation/teardown | 3 | 0 | 3 |
| Capability — permitted | 2 | 0 | 2 |
| Capability — rejected | 3 | 1 | 4 |
| Capability — replay reconstruction | 2 | 0 | 2 |
| Replay — pure replay | 4 | 0 | 4 |
| Replay — live frontier | 4 | 0 | 4 |
| Replay — source-class recovery | 3 | 0 | 3 |
| Replay — at-least-once | 1 | 0 | 1 |
| Journal invariants | 4 | 0 | 4 |
| Kernel non-change | 5 | 0 | 5 |
| **Total** | **69** | **6** | **75** |

### 13.3 Conformance Hook Coverage Matrix

This matrix maps each numbered conformance hook from stream
iteration specification §14 to the test IDs that verify it.

**Compiler Conformance (§14.1)**

| Hook | Requirement | Test IDs |
|---|---|---|
| CT1 | Accept constrained `for...of`, produce §7.2 IR | SI-C-001–010, SI-L-001–011 |
| CT2 | Reject all §4.4 forms with correct violated-rule | SI-C-020–070 |
| CT3 | Reject `each.next()` with E-STREAM-005 | SI-C-040–042 |
| CT4 | Synthetic names bound before reference | SI-L-004 |

**Runtime Conformance (§14.2)**

| Hook | Requirement | Test IDs |
|---|---|---|
| RT1 | `stream.subscribe` returns capability handle | SI-R-001–002 |
| RT2 | `stream.next` returns iterator result | SI-R-003–005 |
| RT3 | Replay both effects from journal | SI-D-001–004 |
| RT4 | Create subscription at live frontier | SI-D-010–013 |
| RT5 | Tear down on scope exit | SI-R-021–022 |
| RT6 | Cancel in-flight `stream.next` | SI-R-020 |
| RT7 | Reject capability escape in hand-constructed IR | SI-V-010–013 |

**Recovery Conformance (§14.3)**

| Hook | Requirement | Test IDs |
|---|---|---|
| RCT1 | Replay N items in same order | SI-D-001, SI-D-022 |
| RCT2 | Live frontier creates subscription and delivers | SI-D-010–011 |
| RCT3 | Cancellation produces no journal entry | SI-R-020 |
| RCT4 | Scope teardown tears down subscription | SI-R-021–022 |
| RCT5 | Capability in agent data rejected | SI-V-010, SI-V-012 |

---

## Appendix A: Implementation Notes

> **Non-normative.** The following notes may help implementers
> build a test harness for the stream-iteration conformance
> plan.

### A.1 Compiler fixture harness

Compiler acceptance and rejection fixtures require a harness
that:

1. Wraps the `source` string in an ambient contract preamble
   (contract declarations for referenced agents, plus a mock
   stream source type).
2. Calls `generateWorkflowModule(source)` or equivalent.
3. For acceptance: inspects the output IR for structural
   properties listed in `expected_ir_shape`.
4. For rejection: verifies the compilation failed and that the
   diagnostic references the `violated_rule` category.

The harness SHOULD NOT compare full IR JSON equality for
compiler fixtures. Structural property checks (subscribe
present, recursive Fn present, synthetic names bound) are
sufficient without over-constraining encoding.

### A.2 Mock stream source

Runtime and replay fixtures require a mock Effection stream
source. The mock MUST:

1. Produce items from the `mock_stream.items` array in order.
2. Signal done after the last item.
3. If `mock_stream.error` is set, produce the error after items.
4. Be constructable from a serializable definition so that
   the `stream.subscribe` effect's resolved data can reference
   it.

The recommended implementation is an in-memory
`createQueue`-backed stream registered in the runtime's source
factory by name.

### A.3 Replay fixture construction

Replay fixtures require constructing `stored_journal` entries
with the correct effect descriptions:

- `stream.subscribe` yields: `{type:"stream", name:"subscribe"}`,
  result: `{status:"ok", value:{__tisyn_subscription:"sub:root:0"}}`.
- `stream.next` yields: `{type:"stream", name:"next"}`,
  result: `{status:"ok", value:{done:false, value:<item>}}`.

The handle token `"sub:root:0"` follows the deterministic
scheme `sub:<coroutineId>:<subscriptionCount>`.

### A.4 Cancellation test mechanics

SI-R-020 (cancellation during in-flight `stream.next`)
requires the test harness to halt the parent scope while the
runtime is waiting for `subscription.next()`. This can be
implemented by:

1. Using a mock stream that blocks on `next()` indefinitely.
2. Spawning the execution in a structured scope.
3. Halting the parent scope after the subscribe YieldEvent is
   observed.
4. Verifying Close(cancelled) with no YieldEvent for the
   in-flight next.

### A.5 Recovery-classification test interpretation

Tests in §8.3 encode the spec's source-class recovery
behavior as *expected* outcomes, not failures. A harness that
flags SI-D-020 (duplicate re-delivery) or SI-D-021 (gap from
volatile source) as failures is itself incorrect — these are
conforming behaviors under the MVP contract.

---

## Final Test-Plan Precision Cleanup

This section documents the exact precision fixes applied in
this pass. No structural changes were made to the plan.

**Fix 1 — Replay over-test guard (§8).** Added an explicit
block-quoted over-test guard note at the top of §8 stating
that stronger replay guarantees than those defined in the MVP
spec MUST NOT be treated as required conformance. The note
itemizes four specific properties that no test MAY assert:
source-sequence-relative item identity at the live frontier,
lossless delivery from volatile sources, absence of
duplicates from idempotent sources, and cursor-based
resumption.

**Fix 2 — Diagnostic assertion style (§2.2).** Strengthened
the compiler rejection fixture note to explicitly state that
diagnostics are compared by violated-rule family only, not by
exact error code number or prose message. Added a reference
to the blocking-scope test plan §2.2 as the model.

**Fix 3 — Capability-value test boundary (§7).** Added a
header paragraph to §7 explaining that all capability-value
tests use hand-constructed IR, not compiled source. For
compiled authored code, the compiler structurally prevents
user access to the synthetic handle, so no compiler-surface
capability test is needed or possible. The runtime enforcement
rules (RV1–RV3) apply only to hand-constructed IR. Renamed
§7.1 to "Permitted Usage (Hand-Constructed IR)" for clarity.

**Fix 4 — Conformance hook coverage matrix (§13.3).** Added
a new §13.3 with three tables mapping every numbered
conformance hook (CT1–CT4, RT1–RT7, RCT1–RCT5) from spec
§14 to the specific test IDs that verify it. This makes
review against the spec's conformance hooks direct and
verifiable.

**Fix 5 — Explicit non-tests (§11).** Added SI-X-013
(performance benchmarks) to the non-tests table, stating
that conformance is functional, not performance-based.
