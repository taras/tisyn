# Tisyn Blocking Scope — Conformance Test Plan

**Tests:** Tisyn Blocking Scope Specification

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the blocking
single-child `scoped(...)` MVP as specified in the Tisyn
Blocking Scope Specification. It covers:

- compiler acceptance and rejection of authored `scoped(...)`
  forms per §3
- IR lowering of `scoped(...)`, `useTransport(...)`,
  `Effects.around(...)`, and `useAgent(...)` per §4 and §9
- kernel evaluation of `scope` nodes per §5
- runtime scope lifecycle per §6
- teardown and error ordering per §7
- replay and durability per §8

### 1.2 What This Plan Does Not Cover

The following are explicitly outside the scope of this test
plan. They correspond to the deferred extensions listed in
blocking scope specification §10.

- `spawn` (non-blocking scope creation)
- `resource` (scoped values)
- nested scope composition semantics (§7.5 non-normative note)
- closure capture in middleware bodies (§10.3)
- per-branch `next(...)` tracking or multi-call `next` (§10.4)
- multiple `Effects.around(...)` per scope (§10.5)
- dynamic transport expressions (§10.6)
- conditional or interleaved setup (§10.7)
- `let`, `while`, `for`, `try/catch/finally` in middleware
  bodies (§10.8)

Tests that would validate deferred behavior are listed in §8
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
- **Replay tests:** journal event sequence after replay matches
  the expected sequence. Deterministic reconstruction from IR
  and environment is verified by comparing replay output to
  original output.

No test depends on implementation internals, intermediate
compiler state, or runtime step ordering beyond the normative
ordering constraints in the spec.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST pass.
A blocking-scope implementation is non-conforming if any Core
test fails.

**Extended:** Tests for edge cases, boundary conditions, and
diagnostic quality. Recommended but not required for initial
conformance.

---

## 2. Fixture Schema Extensions

The blocking-scope test plan introduces two new fixture types
alongside the existing conformance harness types.

### 2.1 Compiler Acceptance Fixture

````typescript
interface CompilerAcceptanceFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "compiler_acceptance";
  source: string;              // authored TypeScript source
  expected_ir_shape: {         // structural checks on output
    id: "scope";
    has_handler: boolean;
    binding_keys: string[];
    body_id?: string;          // top-level IR id of body
  };
}
````

### 2.2 Compiler Rejection Fixture

````typescript
interface CompilerRejectionFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "compiler_rejection";
  source: string;              // authored TypeScript source
  violated_rule: string;       // e.g. "S1", "EA5", "UT2"
}
````

> **Note:** `violated_rule` identifies the constraint from §3
> of the blocking scope spec. The test verifies that the
> compiler rejects the source and that the diagnostic
> references the correct constraint category. Exact error code
> numbers and message wording are not compared.

### 2.3 Existing Fixture Types

Runtime lifecycle, teardown, and replay tests use the existing
`effect`, `replay`, and `negative_runtime` fixture types from
the conformance harness, extended with scope-specific IR
inputs.

---

## 3. Compiler Acceptance Tests

### 3.1 Valid `scoped(...)` Forms

| ID | Tier | Rule | Description | Source shape | Expected |
|---|---|---|---|---|---|
| SC-C-001 | Core | §3.1 | Minimal valid scope: no setup, body returns literal | `scoped(function*() { return 42; })` | Accepted; scope node with null handler, empty bindings, body = literal 42 |
| SC-C-002 | Core | §3.1–3.5 | Full target example: useTransport + Effects.around + useAgent + handle call | Target example from §1 | Accepted; scope node with handler Fn, one binding, body = agent eval |
| SC-C-003 | Core | §3.4 | Multiple useTransport for different contracts | Two useTransport calls for different contracts | Accepted; two binding entries |
| SC-C-004 | Core | §3.5 | Middleware with pass-through only: `return yield* next(eid, data)` | Effects.around with pass-through body | Accepted; handler Fn body = Eval("dispatch", ...) |
| SC-C-005 | Core | §3.5 EA6 | Middleware with result transformation: `const r = yield* next(...); return { status: r.status }` | Effects.around with const + transform + return | Accepted; handler Fn body = Let("r", Eval("dispatch", ...), Construct(...)) |
| SC-C-006 | Core | §3.5 EA3 | Middleware body with nested if/else | `if (eid === "a") { throw ... } else if (eid === "b") { throw ... } return yield* next(eid, data)` | Accepted; handler Fn with nested If nodes |
| SC-C-007 | Core | §3.6–3.7 | useAgent handle call lowers to agent eval | `const h = yield* useAgent(A); return yield* h.method(x)` | Accepted; body contains Eval("a.method", ...) with no useAgent in IR |
| SC-C-008 | Core | §3.5 EA3 | Middleware body using comparison, logical, and arithmetic operators | Body with `effectId !== "x" && data.count > 0` | Accepted |
| SC-C-009 | Core | §3.5 EA3 | Middleware body using object literal construction | `return yield* next(eid, { ...existing fields via mExpr })` | Accepted |
| SC-C-010 | Extended | §3.4 | useTransport with imported identifier | Transport identifier from import statement | Accepted |
| SC-C-011 | Extended | §3.5 EA3 | Middleware body using string template | `` throw new Error(`denied: ${effectId}`) `` | Accepted |
| SC-C-012 | Extended | §3.5 EA3 | Middleware body using ternary expression | `return yield* next(eid, cond ? a : b)` | Accepted |
| SC-C-013 | Core | UA1, §3.2 | useAgent as first body statement after setup | `useTransport(A, t); Effects.around({...}); const h = yield* useAgent(A);` | Accepted; useAgent classified as body, not setup; handle binding created |
| SC-C-014 | Core | §3.4 | useTransport with call expression | `useTransport(A, createTransport())` | Accepted; binding entry contains compiled call expression |
| SC-C-015 | Core | §3.4 | useTransport with property access | `useTransport(A, config.transport)` | Accepted; binding entry contains compiled property-access expression |
| SC-C-016 | Extended | §3.4 | useTransport with string literal | `useTransport(A, "stdio")` | Accepted; transport-factory validity remains a runtime obligation |

### 3.2 `scoped(...)` Form Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-020 | Core | §3.1 | scoped with arrow function argument | `scoped(() => { ... })` | §3.1 |
| SC-C-021 | Core | §3.1 | scoped with non-generator function argument | `scoped(function() { ... })` | §3.1 |
| SC-C-022 | Core | §3.1 | scoped with identifier argument | `scoped(myFn)` | §3.1 |
| SC-C-023 | Extended | §3.1 | scoped with no argument | `scoped()` | §3.1 |

### 3.3 Setup/Body Partitioning Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-030 | Core | S1 | useTransport after body statement | `yield* agent.call(); yield* useTransport(A, t);` | S1 |
| SC-C-031 | Core | S1 | Effects.around after body statement | `const x = yield* useAgent(A); yield* Effects.around({...})` | S1 |
| SC-C-032 | Core | S2 | Conditional useTransport | `if (cond) { yield* useTransport(A, t); }` | S2 |
| SC-C-033 | Core | S2 | Conditional Effects.around | `if (cond) { yield* Effects.around({...}); }` | S2 |
| SC-C-034 | Core | S3 | useTransport inside try block | `try { yield* useTransport(A, t); } catch(e) {}` | S3 |
| SC-C-035 | Core | S5 | Duplicate useTransport for same contract | Two `useTransport(Coder, ...)` calls | S5 |
| SC-C-036 | Core | S6 | Multiple Effects.around in one scope | Two `Effects.around(...)` calls | S6 |

### 3.4 `useTransport` Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-043 | Extended | UT1 | First argument is not a contract identifier | `useTransport(42, t)` | UT1 |

### 3.5 `Effects.around` Shape Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-050 | Core | EA1 | Object with non-dispatch method | `Effects.around({ *handle(...) {} })` | EA1 |
| SC-C-051 | Core | EA1 | Object with multiple methods | `Effects.around({ *dispatch(){}, *other(){} })` | EA1 |
| SC-C-052 | Core | EA2 | dispatch is not a generator method | `Effects.around({ dispatch() {} })` | EA2 |
| SC-C-053 | Core | EA2 | First param not array binding | `Effects.around({ *dispatch(effectId, next) {} })` | EA2 |
| SC-C-054 | Core | EA2 | Array binding has wrong element count | `Effects.around({ *dispatch([a, b, c], next) {} })` | EA2 |
| SC-C-055 | Core | EA2 | No continuation parameter | `Effects.around({ *dispatch([a, b]) {} })` | EA2 |

### 3.6 Middleware Body Closed-Subset Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-060 | Core | EA3 | let declaration in middleware body | `let x = 1;` in dispatch body | EA3 |
| SC-C-061 | Core | EA3 | let reassignment in middleware body | `let x = 1; x = 2;` in dispatch body | EA3 |
| SC-C-062 | Core | EA3 | while loop in middleware body | `while (true) { ... }` in dispatch body | EA3 |
| SC-C-063 | Core | EA3 | try/catch in middleware body | `try { ... } catch(e) { ... }` in dispatch body | EA3 |
| SC-C-064 | Core | EA3 | Arrow function in middleware body | `const f = (x) => x;` in dispatch body | EA3 |
| SC-C-065 | Core | EA3 | new expression (non-Error) in middleware | `const x = new Map();` in dispatch body | EA3 |
| SC-C-066 | Core | EA5 | Two next calls in middleware body | `yield* next(a, b); return yield* next(c, d)` | EA5 |
| SC-C-067 | Core | EA5 | Two next calls in separate branches | `if (x) { return yield* next(a, b); } else { return yield* next(c, d); }` | EA5 |
| SC-C-068 | Core | EA7 | yield* targeting non-next in middleware | `yield* sleep(100)` in dispatch body | EA7 |
| SC-C-069 | Core | EA8 | Free variable from enclosing scope | `blockedList.includes(effectId)` where blockedList is outer | EA8 |
| SC-C-070 | Core | EA6 | next not in return or const position | `yield* next(a, b);` as bare statement | EA6 |
| SC-C-071 | Core | EA6 | next as subexpression | `return transform(yield* next(a, b))` | EA6 |
| SC-C-072 | Extended | EA3 | for loop in middleware body | `for (let i = 0; ...) {}` in dispatch body | EA3 |

### 3.7 `useAgent` Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-081 | Core | UA3 | useAgent without matching useTransport | `useAgent(B)` where only A is transport-bound | UA3 |
| SC-C-082 | Core | UA4 | useAgent not in const declaration | `yield* useAgent(A);` as bare statement | UA4 |
| SC-C-083 | Core | UA4 | useAgent in let declaration | `let h = yield* useAgent(A);` | UA4 |

### 3.8 Handle Usage Rejection

| ID | Tier | Rule | Description | Source shape | Violated |
|---|---|---|---|---|---|
| SC-C-090 | Core | H1 | Handle used in non-method-call position | `return coder;` | H1 |
| SC-C-091 | Core | H2 | Handle passed as argument | `yield* other.call(coder)` | H2 |
| SC-C-092 | Core | H2 | Handle in object literal | `return { agent: coder }` | H2 |
| SC-C-093 | Core | H4 | Handle method not in contract | `yield* coder.nonExistentMethod()` | H4 |
| SC-C-094 | Extended | H4 | Handle method wrong arity | `yield* coder.implement()` (missing arg) | H4 |

---

## 4. IR Lowering Tests

These tests verify the structural shape of the compiled IR
without depending on exact physical encoding. Comparison is
by structural properties of the output, not by JSON equality
of the full tree.

| ID | Tier | Rule | Description | What is checked |
|---|---|---|---|---|
| SC-L-001 | Core | §4.2, C5 | scoped lowers to Eval("scope", Quote(...)) | Output node: tisyn="eval", id="scope", data.tisyn="quote" |
| SC-L-002 | Core | §4.3, C7 | bare-identifier useTransport lowers to binding Ref | `bindings` has key matching toAgentId(contract), value is Ref with correct name |
| SC-L-003 | Core | §4.4, C13 | Effects.around lowers to handler Fn | `handler` is Fn with two params matching the authored names |
| SC-L-004 | Core | §4.4 | Handler Fn body contains dispatch Eval for next(...) | Fn body tree contains Eval with id="dispatch" |
| SC-L-005 | Core | UA5, C17 | useAgent produces no IR node | useAgent does not appear anywhere in scope node; body begins with the first post-useAgent statement |
| SC-L-006 | Core | H3, C20 | Handle call lowers to agent Eval | `yield* coder.implement(spec)` becomes Eval("coder.implement", ...) |
| SC-L-007 | Core | §4.4 | Middleware deny lowers to Throw in Fn body | `throw new Error("denied")` in middleware becomes Throw node in handler Fn |
| SC-L-008 | Extended | §4.2 | Scope with no setup has null handler and empty bindings | `handler: null`, `bindings: {}` |
| SC-L-009 | Extended | §4.4 | Result-transform pattern lowers to Let + dispatch + body | `const r = yield* next(...)` becomes Let with Eval("dispatch", ...) as value |
| SC-L-010 | Core | §4.3, C7 | call-expression useTransport lowers to binding Expr | `bindings` entry value is a `Call` expression tree |
| SC-L-011 | Core | §4.3, C7 | property-access useTransport lowers to binding Expr | `bindings` entry value is a `Get` expression tree |

---

## 4A. Validation Tests

These tests verify IR validation behavior for scope binding
values independently of compiler acceptance and runtime
execution.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-V-001 | Core | §4.6 V3a | Quote node rejected in binding value | Scope IR with binding value = `Quote(42)` | `QUOTE_AT_EVAL_POSITION` |
| SC-V-002 | Core | §4.6 V2 | Expression binding accepted by validator | Scope IR with binding value = `Call(Ref("makeFactory"), [])` | Valid IR |

---

## 4B. Kernel Evaluation Tests

These tests verify kernel behavior for `scope` nodes in
isolation, independent of runtime scope lifecycle. They use
the existing `effect` fixture type to observe the kernel's
yield behavior.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-K-001 | Core | §5.1 | classify("scope") returns EXTERNAL | Evaluate `Eval("scope", ...)` | Kernel classifies as EXTERNAL, not STRUCTURAL |
| SC-K-002 | Core | §5.1 | isCompoundExternal("scope") returns true | Evaluate `Eval("scope", ...)` | Kernel uses unquote path, not resolve path |
| SC-K-003 | Core | §5.2 | Kernel yields descriptor with id "scope" | Evaluate `Eval("scope", Quote({handler: null, bindings: {}, body: 42}))` | Kernel yields descriptor with `id: "scope"` |
| SC-K-004 | Core | §5.2 | Descriptor data contains unquoted inner payload | Evaluate scope node with handler Fn, one binding, body | Yielded descriptor data contains handler, bindings, body as unquoted values (not wrapped in Quote) |
| SC-K-005 | Core | §5.3 | Kernel does not evaluate body before yielding | Scope body contains agent Eval that would produce a second yield | Kernel yields exactly one descriptor (the scope descriptor); body Eval is not reached |

> **Note on observability.** SC-K-001 and SC-K-002 are
> observable through the kernel's yield behavior: compound-
> external nodes yield descriptors with `__tisyn_inner` and
> `__tisyn_env` wrapper fields, while standard externals yield
> descriptors with resolved `data`. SC-K-005 is observable by
> counting kernel yields — a scope node with an agent call in
> its body produces exactly one kernel yield (the scope
> descriptor), not two.

---

## 5. Runtime Lifecycle Tests

These tests use hand-constructed scope IR (not compiled source)
to verify runtime behavior independently of the compiler.
They follow the existing `effect` fixture pattern: provide IR,
mock effects, compare result and journal.

### 5.1 Scope Entry and Body Execution

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-R-001 | Core | R5 | Scope body executes and returns value | Scope with null handler, empty bindings, body = literal 42 | result: ok(42); journal: Close(ok, 42) under child coroutineId |
| SC-R-002 | Core | R2 | Binding expression evaluates from environment | Scope with binding `{a: Get(Ref("cfg"), "transport")}`, env `{cfg: { transport: factory }}` | Agent call dispatched; binding "a" registered |
| SC-R-003 | Core | R4 | Child coroutineId is deterministic | Scope body performs one effect | YieldEvent coroutineId = child_id(parent, 0) |
| SC-R-004 | Core | R2 | Failed binding expression fails before body | Scope with binding expression containing unresolved `Ref("missing")`, env `{}` | result: err; Close(err) under child coroutineId; no YieldEvents |
| SC-R-005 | Core | R3 | Handler installed before body effects | Scope with deny-all handler Fn, body calls agent | result: err (denied); no YieldEvent (handler blocked before dispatch) |
| SC-R-006 | Core | R3 | Handler Fn allows effect pass-through | Scope with pass-through handler, body calls agent | YieldEvent dispatched; result returned |
| SC-R-007 | Core | R3 | Handler Fn transforms request data | Scope with handler that modifies data, body calls agent | YieldEvent data matches transformed value |
| SC-R-008 | Core | R2 | Effectful binding expression fails before body | Scope with binding expression that yields external effect | result: err; no body execution |
| SC-R-009 | Core | R2 | Non-Ref binding expression succeeds | Scope with binding value = property access or call expression evaluating to factory | body executes normally; binding installed |

### 5.2 Handler Fn Evaluation

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-R-010 | Core | §4.4 | Handler denies by throwing | Handler Fn: If(Eq(Ref("effectId"), Q("x")), Throw("denied"), Eval("dispatch", ...)) | effect "x" → err("denied"); effect "y" → dispatched |
| SC-R-011 | Core | §4.4 | Handler short-circuits with literal | Handler Fn returns literal without calling dispatch | result = literal; no YieldEvent |
| SC-R-012 | Core | §4.4 | Handler transforms result via Let | Handler Fn: Let("r", Eval("dispatch", ...), Construct({...})) | result = transformed object |
| SC-R-013 | Core | §4.4 | Dispatch error propagates through handler | Handler calls dispatch; inner chain throws | err propagates to scope body |

### 5.3 Multiple Bindings

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-R-020 | Core | R2 | Multiple bindings all resolved | Scope with two binding entries, both evaluable in env | Both agent prefixes dispatch correctly |
| SC-R-021 | Core | R2, §6.3 | Second binding expression fails scope | Scope with two bindings, second failing to evaluate | err; no body execution |

---

## 6. Teardown and Error Ordering Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-T-001 | Core | T1–T3 | Success: body Close then parent resumes | Scope body returns value | Close(ok, V) under child id; parent result = V |
| SC-T-002 | Core | T4–T6 | Failure: body Close(err) then parent receives error | Scope body throws | Close(err, E) under child id; parent result = err |
| SC-T-003 | Core | T7–T11 | Cancellation: body Close(cancelled) | Parent cancelled while scope body suspended on effect | Close(cancelled) under child id |
| SC-T-004 | Core | T13 | Close appears before parent resumption | Scope body performs effect then returns | Journal: child YieldEvent, child CloseEvent, then parent continues (next parent YieldEvent or CloseEvent after child Close) |
| SC-T-005 | Core | T14 | Scope inside try/catch: error caught after teardown | Scope in try block; body throws; catch catches | Parent catches error; result reflects catch path; child Close(err) precedes parent catch execution |
| SC-T-006 | Extended | T1–T3, T12 | Repeated `scoped(...)` in `while` tears down between iterations | Parent loop executes two sequential `scoped(...)` iterations, each installing scope-local middleware and/or transport binding | Iteration 2 observes only its own scope-local state; no middleware/transport leakage from iteration 1; child ids/journal ordering remain sequential |

---

## 7. Replay and Durability Tests

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| SC-D-001 | Core | §8.1 | No scope-enter or scope-exit events in journal | Scope body performs agent call | Journal contains only YieldEvent + CloseEvent; no "scope" events |
| SC-D-002 | Core | §8.2 | Body YieldEvent under child coroutineId | Scope body performs agent call | YieldEvent.coroutineId = child_id(parent, 0) |
| SC-D-003 | Core | §8.2 | Body CloseEvent under child coroutineId | Scope body completes | CloseEvent.coroutineId = child_id(parent, 0) |
| SC-D-004 | Core | §8.3 | Full replay produces identical result | Execute scope IR, collect journal; replay with same IR + env + stored journal | Replay result = original result; no new events appended |
| SC-D-005 | Core | §8.3 | Replay reconstructs handler from IR | Execute with deny handler, agent calls "x"; replay from journal | Replay produces same result (denied) without live dispatch |
| SC-D-006 | Core | §8.3 | Partial replay continues from stored events | Scope body has two effects; journal has first effect stored; replay | First effect replayed; second dispatched live |
| SC-D-007 | Core | §8.5 | Crash before any body events: full re-execution | Empty stored journal for child coroutineId | All body effects dispatched live |
| SC-D-008 | Core | §8.5 | Crash after body Close: result replayed | Stored journal includes child Close(ok, V) | Parent resumes with V; no live dispatch |
| SC-D-009 | Core | §8.4 | Handler denial replays deterministically | Handler denies "x"; first run produces err; replay with same IR | Same err on replay; no YieldEvent for denied effect |

---

## 8. Explicit Non-Tests (Deferred Coverage)

The following tests are intentionally NOT part of this test
plan. They correspond to behavior deferred in blocking scope
specification §10.

| ID | Deferred item | Spec ref | Why not tested |
|---|---|---|---|
| SC-X-001 | spawn scope creation | §10.1 | Journal interleaving not specified |
| SC-X-002 | resource scoped values | §10.2 | Lifecycle not specified |
| SC-X-003 | Closure capture in middleware | §10.3 | Violates Fn §9.4; not accepted |
| SC-X-004 | Multiple next calls per branch | §10.4 | Rejected by EA5 total-count rule |
| SC-X-005 | Multiple Effects.around per scope | §10.5 | Rejected by S6 |
| SC-X-007 | Conditional setup | §10.7 | Rejected by S2 |
| SC-X-008 | let in middleware body | §10.8 | Rejected by EA3 closed set |
| SC-X-009 | while in middleware body | §10.8 | Rejected by EA3 closed set |
| SC-X-010 | try/catch in middleware body | §10.8 | Rejected by EA3 closed set |
| SC-X-011 | Nested scope composition | §7.5 non-normative | No normative rules to test |
| SC-X-012 | Scope + compound concurrency composition | §7.5 non-normative | No normative rules to test |
| SC-X-013 | Environment mismatch on replay | §8.6 | Spec says this is an input mismatch but does not normatively define behavior; input validation deferred per scoped effects spec §9 |

> **Note:** SC-X-004 through SC-X-010 have corresponding
> rejection tests in §3 (SC-C-060 through SC-C-072) that
> verify the compiler rejects these forms. The non-tests here
> confirm that runtime/replay behavior for these forms is not
> tested because they cannot reach runtime.

---

## 9. Coverage Summary

### 9.1 Spec Section Coverage

| Spec section | Test category | Test IDs | Status |
|---|---|---|---|
| §3.1 Accepted form | Compiler acceptance + rejection | SC-C-001, SC-C-020–023 | Covered |
| §3.2 Setup/body partitioning | Compiler rejection | SC-C-030–036 | Covered |
| §3.3 Setup restrictions (S1–S6) | Compiler rejection | SC-C-030–036 | Covered |
| §3.4 useTransport (UT1–UT3) | Compiler acceptance + rejection | SC-C-003, SC-C-010, SC-C-014–016, SC-C-043 | Covered |
| §3.5 Effects.around (EA1–EA9) | Compiler acceptance + rejection | SC-C-004–012, SC-C-050–072 | Covered |
| §3.6 useAgent (UA1–UA5) | Compiler acceptance + rejection | SC-C-007, SC-C-013, SC-C-081–083 | Covered |
| §3.7 Handle restrictions (H1–H4) | Compiler rejection | SC-C-090–094 | Covered |
| §4.2–4.4 IR shape | IR lowering | SC-L-001–011 | Covered |
| §4.6 Validation | Validation + runtime lifecycle | SC-V-001–002, SC-R-004 | Covered |
| §5.1–5.3 Kernel evaluation | Kernel evaluation | SC-K-001–005 | Covered |
| §6.1 Scope entry (R1–R5) | Runtime lifecycle | SC-R-001–009 | Covered |
| §6.2 Scope exit (R6–R8) | Teardown | SC-T-001–002 | Covered |
| §6.3 Binding resolution errors | Runtime lifecycle | SC-R-004, SC-R-008, SC-R-021 | Covered |
| §7.1 Success (T1–T3) | Teardown | SC-T-001 | Covered |
| §7.2 Failure (T4–T6) | Teardown | SC-T-002 | Covered |
| §7.3 Cancellation (T7–T11) | Teardown | SC-T-003 | Covered |
| §7.4 Ordering invariants (T12–T14) | Teardown | SC-T-004–005 | Covered |
| §7.5 Concurrency/nesting | Non-normative | — | Not tested (deferred) |
| §8.1 No new event types | Replay | SC-D-001 | Covered |
| §8.2 Body events | Replay | SC-D-002–003 | Covered |
| §8.3 Replay reconstruction | Replay | SC-D-004–006 | Covered |
| §8.4 Determinism | Replay | SC-D-009 | Covered |
| §8.5 Crash recovery | Replay | SC-D-007–008 | Covered |
| §8.6 Environment consistency | — | SC-X-013 | Not tested (deferred; input validation not specified) |
| §10 Deferred extensions | Non-tests | SC-X-001–013 | Explicitly excluded |

### 9.2 Test Count Summary

| Category | Core | Extended | Total |
|---|---|---|---|
| Compiler acceptance | 10 | 3 | 13 |
| Compiler rejection — form | 3 | 1 | 4 |
| Compiler rejection — setup/body | 7 | 0 | 7 |
| Compiler rejection — useTransport | 3 | 1 | 4 |
| Compiler rejection — Effects.around shape | 6 | 0 | 6 |
| Compiler rejection — middleware subset | 12 | 1 | 13 |
| Compiler rejection — useAgent | 3 | 0 | 3 |
| Compiler rejection — handle usage | 4 | 1 | 5 |
| IR lowering | 7 | 2 | 9 |
| Kernel evaluation | 5 | 0 | 5 |
| Runtime lifecycle | 13 | 0 | 13 |
| Teardown/error ordering | 5 | 0 | 5 |
| Replay/durability | 9 | 0 | 9 |
| **Total** | **87** | **9** | **96** |

---

## 10. Conformance Rule

An implementation passes blocking-scope conformance if and only
if:

1. All Core tier compiler acceptance fixtures produce a scope
   node conforming to the expected IR shape.

2. All Core tier compiler rejection fixtures produce a
   diagnostic that identifies the violated constraint category.

3. All Core tier kernel evaluation fixtures produce the
   expected descriptor yield behavior.

4. All Core tier runtime lifecycle, teardown, and replay
   fixtures produce the expected result status, result value
   (canonical JSON equality), and journal event sequence
   (canonical JSON equality per event).

5. No Core tier fixture produces an unexpected error, hangs,
   or crashes.

---

## Appendix A: Implementation Notes

> **Non-normative.** The following notes may help implementers
> build a test harness for the blocking-scope conformance plan.

### A.1 Compiler fixture harness

Compiler acceptance and rejection fixtures require a harness
that:

1. Wraps the `source` string in an ambient contract preamble
   (contract declarations for any referenced agents).
2. Calls `generateWorkflowModule(source)` or equivalent.
3. For acceptance: inspects the output IR for structural
   properties listed in `expected_ir_shape`.
4. For rejection: verifies the compilation failed and that the
   diagnostic references the `violated_rule` category.

The harness SHOULD NOT compare full IR JSON equality for
compiler fixtures. Structural property checks (node id,
handler presence, binding keys, body top-level id) are
sufficient for conformance without over-constraining encoding.

### A.2 Runtime fixture harness

Runtime lifecycle and teardown tests use hand-constructed scope
IR as input. The existing conformance harness's `effect` and
`negative_runtime` fixture runners can be extended to handle
scope nodes by adding `"scope"` to the kernel's compound-
external set and adding the scope handler to the runtime's
dispatch loop.

Mock dispatch middleware (existing `installMockDispatch` from
the conformance harness) is used for agent effect responses
within scope bodies.

### A.3 Cancellation test mechanics

SC-T-003 (cancellation) requires the test harness to cancel
the parent scope while the scope body is suspended on an
effect. This can be implemented by:

1. Spawning the execution in a structured scope.
2. Halting the parent scope after the body's first YieldEvent
   is observed.
3. Verifying the child Close(cancelled) event appears.

The exact mechanism depends on the structured concurrency
substrate. Effection's `spawn` + `halt` pattern is the
expected approach.

### A.4 Transport teardown observability

The normative teardown ordering (T12: teardown before parent
resumption) is verified through journal ordering (SC-T-004)
and error propagation ordering (SC-T-005). Direct observation
of transport shutdown timing is implementation-specific and
not portably testable through journal events or result values.

Implementers MAY add harness-specific tests that observe
transport cleanup via Effection's `ensure` or lifecycle hooks.
Such tests are useful for implementation confidence but are
not part of the normative conformance plan.

### A.5 Replay fixture construction

Replay fixtures (SC-D-004 through SC-D-009) require
constructing `stored_journal` entries with the correct child
coroutineId. The child id is `child_id(parent_id, 0)` where
`parent_id` is typically `"root"` for top-level tests, giving
child id `"root.0"`.

### A.6 `Effects.around` compiler spike

The compiler acceptance tests for `Effects.around(...)` (SC-C-
002, SC-C-004–006, SC-C-008–012) depend on the compiler being
able to extract the AST pattern described in blocking scope
specification §3.5. If the compiler spike (Appendix B of the
blocking scope spec) has not been completed, these tests may
be initially implemented as IR-level tests using hand-
constructed scope nodes, with compiler-level tests added after
the spike confirms AST extraction feasibility.
