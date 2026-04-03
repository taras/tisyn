# Tisyn Timebox and Converge — Conformance and Testing Plan

**Version:** 0.1.0
**Tests:** Tisyn Timebox Specification 0.1.0,
Tisyn Converge Compiler and Authoring Amendment 0.1.0
**Status:** Draft

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the `timebox`
compound external operation and the `converge` compiler
sugar as specified in the Tisyn Timebox Specification v0.1.0
and the Tisyn Converge Compiler and Authoring Amendment
v0.1.0. It covers:

- Compiler acceptance and rejection of authored `timebox`
  and `converge` forms
- IR validation of `timebox` nodes, including duration
  subtree constraints
- IR lowering of `converge` to `timebox` + recursive Fn +
  Call
- Kernel evaluation of `timebox` duration
- Runtime orchestration of `timebox` child tasks
- Deterministic child allocation
- Simultaneous-completion semantics (TB-R6)
- Result semantics for success, timeout, and error
- Cancellation behavior
- Journal ordering rules
- Replay and crash recovery
- Composition with other compound externals

### 1.2 What This Plan Does Not Cover

- Retry semantics (`timebox` constrains a single attempt)
- Probe error retry (`converge` v1 propagates errors)
- Exponential or variable backoff (`converge` v1 uses fixed
  interval)
- Journal compression (explicitly rejected)
- `converge` as a compound external or runtime primitive
  (explicitly rejected)

### 1.3 Observability Model

All tests compare observable outputs only:

- **Compiler tests:** acceptance (produces conforming IR)
  or rejection (produces a diagnostic identifying the
  violated constraint). Diagnostics are compared by
  violated-rule category, not by message wording.
- **Runtime tests:** result value, result status, and
  journal event sequence. Journal events are compared using
  canonical JSON equality per the existing conformance
  harness.
- **Replay tests:** journal event sequence after replay
  matches the expected sequence. Deterministic
  reconstruction from IR and environment is verified by
  comparing replay output to original output.
- **Journal tests:** per-coroutineId event sequences.
  Cross-coroutineId ordering is validated only via explicit
  ordering constraints, never by global position.

No test depends on implementation internals, intermediate
compiler state, or runtime step ordering beyond the
normative ordering constraints in the specifications.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST
pass. An implementation is non-conforming if any Core test
fails.

**Extended:** Tests for edge cases, boundary conditions,
performance characteristics, and diagnostic quality.
Recommended but not required for initial conformance.

---

## 2. Fixture Schema Extensions

### 2.1 Timebox Runtime Fixture

```typescript
interface TimeboxRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "timebox_runtime";
  ir: Expr;
  env: Record<string, Val>;
  effects: Array<{
    descriptor: EffectDescriptor;
    result: EventResult;
    coroutineId?: string;
  }>;
  expected: {
    status: "ok" | "err" | "cancelled";
    value?: Val;
    error?: string;
    journal: {
      [coroutineId: string]: Array<YieldEntry | CloseEntry>;
    };
    journal_ordering?: Array<OrderingConstraint>;
  };
}
```

The `journal` field uses per-coroutineId event sequences,
following the spawn and resource test plan convention. Each
coroutineId's events MUST appear in `yieldIndex` order
within that coroutineId. Cross-coroutineId ordering is
validated only via explicit `journal_ordering` constraints.

### 2.2 Compiler Fixtures

Uses the existing `CompilerAcceptanceFixture` and
`CompilerRejectionFixture` types. The `violated_rule` field
references timebox constraint identifiers (TB-V5–TB-V7) or
converge error codes (E-CONV-01 through E-CONV-09,
W-CONV-01).

### 2.3 Ordering Constraint Schema

```typescript
interface OrderingConstraint {
  type: "before";
  earlier: { coroutineId: string; event: "close" | "yield"; yieldIndex?: number };
  later: { coroutineId: string; event: "close" | "yield"; yieldIndex?: number };
}
```

---

## 3. Compiler Acceptance Tests

### 3.1 `timebox` — Authored Form Recognition

| ID | Tier | Input | Expected |
|---|---|---|---|
| TAC-01 | Core | `yield* timebox(5000, function*() { return yield* A().m(); })` | Accepted. Produces `Eval("timebox", ...)` IR with literal duration. |
| TAC-02 | Core | `const t = 3000; yield* timebox(t, function*() { ... })` where `t` is a prior const binding | Accepted. Duration is `Ref("t")`. |
| TAC-03 | Core | `const t = yield* Config().get(); yield* timebox(t, function*() { ... })` where `t` is bound via prior `yield*` | Accepted. Duration is `Ref("t")`. The effect is in a prior Let, not inside the timebox argument. |
| TAC-04 | Core | `yield* timebox(5000, function*() { return "hello"; })` | Accepted. Body returns a literal. |
| TAC-05 | Extended | `yield* timebox(5000, function*() { const x = yield* A().m(); if (x > 0) { return x; } return yield* B().fallback(); })` | Accepted. Body contains control flow. |

### 3.2 `converge` — Authored Form Recognition

| ID | Tier | Input | Expected |
|---|---|---|---|
| CAC-01 | Core | Full valid `converge({...})` with generator probe, arrow until, numeric literal interval/timeout | Accepted. Produces `timebox` IR with Fn + Call body. |
| CAC-02 | Core | Probe references outer `const` binding | Accepted. Free Ref resolves via call-site resolution. |
| CAC-03 | Core | Probe references workflow parameter | Accepted. |
| CAC-04 | Core | `until` uses property access and equality | Accepted. Lowers to `Get` + `Eq` in Fn body. |
| CAC-05 | Core | Multi-step probe with multiple `yield*` calls | Accepted. Probe body compiles to a nested Let chain in the `__probe_0` value position. |
| CAC-06 | Core | `const pi = yield* Config().pollInterval(); const dl = yield* Config().timeout(); yield* converge({ ..., interval: pi, timeout: dl })` | Accepted. Dynamic values from prior bindings. |

---

## 4. Compiler Rejection Tests

### 4.1 `timebox` — Rejected Forms

| ID | Tier | Input | Expected Error |
|---|---|---|---|
| TRJ-01 | Core | `yield* timebox(5000)` — missing body | Missing argument |
| TRJ-02 | Core | `yield* timebox(5000, (x) => x)` — arrow function body | Body must be generator function (TB-V6) |
| TRJ-03 | Core | `yield* timebox(5000, myFn)` — variable reference body | Body must be generator function expression (TB-V6) |
| TRJ-04 | Core | `yield* timebox(5000, function*() {}, "extra")` — extra arg | Too many arguments (TB-V5) |
| TRJ-05 | Core | `yield* timebox(yield* Config().get(), function*() { ... })` — `yield*` in duration argument | `yield*` not allowed in expression position (TB-V7) |

### 4.2 `converge` — Rejected Forms

| ID | Tier | Input | Expected Error |
|---|---|---|---|
| CRJ-01 | Core | `converge({})` — empty config | Missing required fields |
| CRJ-02 | Core | `converge({ probe: (x) => x, ... })` — arrow probe | E-CONV-01 |
| CRJ-03 | Core | `converge({ ..., until: function*(s) { ... } })` — generator until | E-CONV-02 |
| CRJ-04 | Core | `converge({ ..., until: (s) => { return s.ready; } })` — block body until | E-CONV-03 |
| CRJ-05 | Core | `converge({ ..., until: (s) => yield* check(s) })` — effectful until | E-CONV-04 |
| CRJ-06 | Core | `converge({ probe: ..., until: ..., interval: 500 })` — missing timeout | E-CONV-06 |
| CRJ-07 | Core | `const cfg = {...}; yield* converge(cfg)` — variable config | E-CONV-07 |
| CRJ-08 | Core | `converge({ ..., interval: yield* Config().poll() })` — `yield*` in interval | E-CONV-08 |
| CRJ-09 | Core | `converge({ ..., timeout: yield* Config().timeout() })` — `yield*` in timeout | E-CONV-09 |

### 4.3 `converge` — Warning Cases

| ID | Tier | Input | Expected Warning |
|---|---|---|---|
| CRW-01 | Core | `converge({ probe: function*() { return 42; }, ... })` — effectless probe | W-CONV-01 emitted. Compilation succeeds. |

---

## 5. IR Validation Tests

### 5.1 `timebox` — Duration Subtree Validation

| ID | Tier | Description | Expected |
|---|---|---|---|
| TIV-01 | Core | `duration` is a literal | Passes validation. |
| TIV-02 | Core | `duration` is a Ref | Passes validation. |
| TIV-03 | Core | `duration` is `Eval("mul", Q({a: 5000, b: 2}))` — structural expression | Passes validation. |
| TIV-04 | Core | `duration` is `Eval("config.getTimeout", [])` — external Eval | Fails validation (TB-V4). |
| TIV-05 | Core | `duration` is `Eval("add", Q({a: Eval("config.getBase", []), b: 1000}))` — structural expression containing an external Eval at depth | Fails validation (TB-V4). |
| TIV-06 | Core | `body` contains external Evals | Passes validation. No restriction on body contents. |

---

## 6. IR Lowering Tests

### 6.1 `timebox` — IR Shape Verification

| ID | Tier | Description | Assertion |
|---|---|---|---|
| TIR-01 | Core | Literal-duration timebox | IR root is `Eval("timebox", ...)` with `duration: 5000` inside the Quote. |
| TIR-02 | Core | Ref-duration timebox | Duration field is `Ref("t")`. Let binding for `t` precedes the timebox node in the IR tree. |
| TIR-03 | Core | Body is a single agent call | Body field is an external Eval node. |
| TIR-04 | Extended | Body contains control flow | Body field contains nested Let/If/Eval nodes. |

### 6.2 `converge` — IR Lowering Verification

| ID | Tier | Description | Assertion |
|---|---|---|---|
| CIR-01 | Core | Basic converge | Produces `Eval("timebox", ...)` IR. No `"converge"` id appears anywhere in the IR. |
| CIR-02 | Core | Timeout field becomes timebox duration | `duration` field in the timebox Quote equals the authored `timeout` value. |
| CIR-03 | Core | `__until_0` Fn | Body contains `Let("__until_0", Fn(["v"], ...), ...)`. Fn body is structural only (no external Eval nodes). |
| CIR-04 | Core | `__poll_0` recursive Fn | Body contains `Let("__poll_0", Fn([], ...), ...)` where the Fn body contains a recursive `Call` to `Ref("__poll_0")`. |
| CIR-05 | Core | Single-effect probe expression in value position | `__probe_0` Let's value field is a single external Eval (the compiled probe expression). |
| CIR-06 | Core | Multi-step probe expression in value position | `__probe_0` Let's value field is a nested Let chain containing multiple external Evals (the compiled multi-step probe expression). |
| CIR-07 | Core | `"sleep"` effect in else branch | The `if` else-branch contains `Eval("sleep", ...)` with the interval value as effect data. |
| CIR-08 | Core | `if` uses `condition` field | The `if` node's Quote expr has field `condition`, not `test`. |
| CIR-09 | Core | Free variables preserved | Outer Ref (e.g., `deployId`) appears in the probe expression inside `__poll_0`'s Fn body. |
| CIR-10 | Core | Dynamic interval from prior binding | When `interval` is a variable, `Eval("sleep", ...)` uses `Ref("<varName>")` as effect data. |
| CIR-11 | Core | `until` receives probe result via Ref | The `call` node's args contain `Ref("__probe_0")`, which at runtime resolves to the evaluated probe result. |
| CIR-12 | Core | `then` branch returns probe result via Ref | The `if` then-branch is `Ref("__probe_0")`, which at runtime resolves to the evaluated probe result. |

---

## 7. Runtime Behavior Tests — Timebox

### 7.1 Happy Path

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-01 | Core | Body completes before deadline | Result is `{ status: "completed", value: V }`. |
| TRT-02 | Core | Body completes immediately with short timeout | Result is `completed`. |
| TRT-03 | Core | Body returns `undefined` | Result is `{ status: "completed", value: null }`. Distinguishable from timeout. |
| TRT-04 | Core | Deadline fires before body completes | Result is `{ status: "timeout" }`. |
| TRT-05 | Core | Zero-duration timeout, body has at least one pending external effect | Body has not reached terminal state when the timeout `"sleep"` completes immediately. Result is `{ status: "timeout" }`. |
| TRT-05b | Core | Zero-duration timeout, body completes immediately (pure body, no external effects) | Both children reach terminal state. Body outcome takes precedence (TB-R6). Result is `{ status: "completed", value: V }`. Both children have `Close(ok)` (TB-R6a). |
| TRT-06 | Core | Body calls `"sleep"` for less than duration | Body completes. Result is `completed`. |

### 7.2 Error Propagation

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-10 | Core | Body throws before deadline | Error propagates through timebox. |
| TRT-11 | Core | `try/catch` around timebox catches inner error | Error is caught. |
| TRT-12 | Core | Timeout result does NOT trigger catch | Timeout result passes through try/catch as a normal value. |
| TRT-13 | Extended | Body throws during `finally` after timeout | Cleanup error follows existing `finally` error semantics. |

### 7.3 Cancellation

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-20 | Core | External cancellation during body | Both children halt. Finally effects run. CloseEvents written. |
| TRT-21 | Core | External cancellation during timeout `"sleep"` | Both children halt. |
| TRT-22 | Core | Losing child's finally effects run on timeout | Body child's finally effects journaled under body-child coroutineId before body-child Close. |

### 7.4 Duration Evaluation

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-30 | Core | Literal duration `5000` | Kernel evaluates to 5000. Runtime receives 5000. |
| TRT-31 | Core | Ref duration `Ref("t")` where t=3000 | Kernel evaluates to 3000. Runtime receives 3000. |
| TRT-32 | Core | Structural expression duration `Eval("mul", Q({a: Ref("base"), b: 2}))` | Kernel evaluates. Runtime receives the product. |
| TRT-33 | Core | Non-numeric duration | Kernel raises TypeError. Timebox is NOT dispatched. |
| TRT-34 | Core | Negative duration | Kernel raises TypeError. |
| TRT-35 | Core | Malformed IR: external Eval in duration reaches kernel (bypassed validation) | Kernel raises a deterministic error. Timebox is NOT dispatched. |

### 7.5 Placement

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-40 | Core | `timebox` inside `finally` block | Timebox executes. Body child and timeout child effects are journaled under their respective child coroutineIds, NOT under the parent coroutineId. Parent cleanup resumes after both children reach terminal states. |

### 7.6 Deterministic Child Allocation

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-50 | Core | Single `timebox` as first child of parent | Body child is `parentId.0`. Timeout child is `parentId.1`. Parent `childSpawnCount` is 2 after the timebox. |
| TRT-51 | Core | `spawn` then `timebox` then `spawn` | First spawn is `parentId.0`. Timebox body is `parentId.1`, timeout is `parentId.2`. Second spawn is `parentId.3`. All journal entries use these exact IDs. |
| TRT-52 | Core | Two sequential `timebox` calls | First timebox: body is `parentId.0`, timeout is `parentId.1`. Second timebox: body is `parentId.2`, timeout is `parentId.3`. Parent `childSpawnCount` is 4. |

### 7.7 Simultaneous Completion

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| TRT-53 | Core | Body completes successfully and timeout `"sleep"` also completes before parent resumes | Body outcome takes precedence (TB-R6). Result is `{ status: "completed", value: V }`. Body child Close is `ok`. Timeout child Close is `ok` (already completed; not reclassified per TB-R6a). |
| TRT-54 | Core | Body throws error and timeout `"sleep"` also completes before parent resumes | Body outcome takes precedence (TB-R6). Error propagates through timebox. Body child Close is `error`. Timeout child Close is `ok` (already completed; not reclassified per TB-R6a). |

---

## 8. Runtime Behavior Tests — Converge

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| CRT-01 | Core | Single-effect probe converges on 1st attempt | Result `completed` with the evaluated probe result. Journal has 1 probe YieldEvent, 0 `"sleep"` YieldEvents. |
| CRT-02 | Core | Single-effect probe converges on 3rd attempt | Result `completed` with the 3rd evaluated probe result. Journal has 3 probe YieldEvents + 2 `"sleep"` YieldEvents. |
| CRT-03 | Core | Multi-step probe (2 effects) converges on 2nd attempt | Result `completed` with the 2nd evaluated probe result. Journal has 4 probe-effect YieldEvents (2 per iteration × 2 iterations) + 1 `"sleep"` YieldEvent. |
| CRT-04 | Core | Probe never converges within timeout | Result `timeout`. |
| CRT-05 | Core | `until` receives evaluated probe result | Assert `until`'s argument is the Val produced by evaluating the probe expression, including compound results from multi-step probes. |
| CRT-06 | Core | Probe expression throws on 2nd iteration | Error propagates. Journal contains all effects from iteration 1 (1 probe YieldEvent + 1 `"sleep"` YieldEvent), plus the errored probe effect from iteration 2 (1 YieldEvent recording the error result). Body child Close is `error`. Timeout child Close is `cancelled`. |
| CRT-07 | Core | External cancellation during probe | Polling halted. Both children cancelled. |
| CRT-08 | Core | External cancellation during interval `"sleep"` | Polling halted. Both children cancelled. |
| CRT-09 | Extended | Effectless probe, `until` satisfied by probe result (e.g., probe returns `42`, `until: (v) => v === 42`) | Compiler warning W-CONV-01 emitted. Converge succeeds on first iteration. Result is `{ status: "completed", value: 42 }`. No probe YieldEvents in journal (probe expression is pure). One body-child Close. |

---

## 9. Replay and Crash Tests

| ID | Tier | Scenario | Expected |
|---|---|---|---|
| RPL-01 | Core | Replay completed timebox | Body child replays from journal. Same `completed` result. |
| RPL-02 | Core | Replay timed-out timebox | Timeout child replays its `"sleep"` YieldEvent. Same `timeout` result. |
| RPL-03 | Core | Replay converge — single-effect probe, 3 iterations | 3 probe results + 2 `"sleep"` results replay. Same convergence on iteration 3. |
| RPL-04 | Core | Replay converge — multi-step probe, 2 iterations | 4 probe-effect results + 1 `"sleep"` result replay. Same convergence on iteration 2. |
| RPL-05 | Core | Replay converge — timeout | All probe/sleep results replay. Same `timeout` result. |
| RPL-06 | Core | Crash during timebox body, restart | Replays completed body effects. Resumes live at first un-journaled effect. |
| RPL-07 | Core | Crash during converge polling (between iterations), restart | Replays completed probe and `"sleep"` effects. Resumes live at next effect. |
| RPL-08 | Core | Crash during multi-step probe (between effects within one iteration), restart | First probe effect replays. Second executes live. Evaluated probe result is the same because the same effect results are fed to the kernel. |
| RPL-09 | Core | Crash during interval `"sleep"`, restart | `"sleep"` replays. Next probe executes live. |
| RPL-10 | Core | Crash after timebox completes, before next parent effect | Journal has child Closes. Parent resumes correctly. |
| RPL-11 | Core | Replay of simultaneous-completion timebox (TB-R6) | Both children have `Close(ok)` in journal. Replay applies body-precedence rule (TB-R6). Result is `{ status: "completed", value: V }` — same as live execution. |

---

## 10. Journaling Tests

| ID | Tier | Assertion |
|---|---|---|
| JRN-01 | Core | Timebox does NOT produce a parent YieldEvent (TB-J1). |
| JRN-02 | Core | Body child effects produce YieldEvents under body coroutineId (TB-J2). |
| JRN-03 | Core | Timeout child's `"sleep"` effect produces a YieldEvent under timeout coroutineId with effect id `"sleep"` (TB-J3). |
| JRN-04 | Core | Both children produce CloseEvents (TB-J4). |
| JRN-05 | Core | Winner Close status is `ok`. Loser Close status is `cancelled` if the loser was still running when halted, or `ok` if the loser had already completed before halt was called (TB-R6a). |
| JRN-06 | Core | Child Closes precede parent continuation (ordering constraint O2/O5). |
| JRN-07 | Core | If the losing child was cancelled (still running when halted), its cleanup effects continue its yieldIndex sequence (TB-J5). If it had already completed, no cleanup effects are produced. |
| JRN-08 | Core | Timebox inside `finally`: body child and timeout child effects are journaled under their own child coroutineIds, not under the parent cleanup coroutineId (TB-J6). |
| JRN-09 | Core | Converge with single-effect probe: each iteration produces one probe-effect YieldEvent and (if not converged) one `"sleep"` YieldEvent. |
| JRN-10 | Core | Converge with multi-step probe: each iteration produces one YieldEvent per probe-body external effect and (if not converged) one `"sleep"` YieldEvent. |
| JRN-11 | Core | Converge: `until` evaluations NOT in journal. |
| JRN-12 | Core | Converge: body-child yieldIndex is monotonically increasing across all probe effects and `"sleep"` effects. |
| JRN-13 | Core | Timebox child IDs are deterministic: body child is `parentId.N`, timeout child is `parentId.N+1`, where N is the parent's `childSpawnCount` at timebox entry. All journal entries for body and timeout children use these exact coroutineIds. |
| JRN-14 | Core | Timebox after other child-creating operations: child IDs continue the parent's `childSpawnCount` sequence without gaps or overlaps. |
| JRN-15 | Core | Simultaneous completion: if both children complete before the parent resumes, both retain `Close(ok)` (TB-R6a). Body outcome takes precedence (TB-R6). The journal MUST NOT retroactively reclassify a completed child as `cancelled`. |

---

## 11. Composition Tests

| ID | Tier | Scenario |
|---|---|---|
| CMP-01 | Core | `timebox` inside `all` — multiple timeboxed operations, some complete, some timeout. |
| CMP-02 | Core | `timebox` inside `race` — first timebox to resolve wins. |
| CMP-03 | Core | `timebox` containing `spawn` — spawned tasks cancelled on timeout. |
| CMP-04 | Extended | `timebox` containing `all`/`race` — compound effects inside body cancelled on timeout. |
| CMP-05 | Core | `timebox` inside `try/catch/finally`. |
| CMP-06 | Extended | Nested `timebox` — inner times out, outer continues. |
| CMP-07 | Core | `timebox` inside `finally` — child effects journaled under child coroutineIds, not parent. |
| CMP-08 | Extended | `converge` inside `all` — parallel convergence. |
| CMP-09 | Extended | `converge` inside `race` — first convergence wins. |
| CMP-10 | Extended | `converge` inside outer `timebox` — outer timeout overrides. |
| CMP-11 | Extended | `converge` inside `try/catch/finally`. |
| CMP-12 | Extended | `converge` inside `scope` with middleware. |

---

## 12. Dedicated Testing Plan

### 12.1 Unit Tests — Compiler

- **Timebox lowering.** For each authored `timebox` variant
  (literal duration, variable duration from prior binding,
  simple body, complex body), verify the emitted IR matches
  the expected `Eval("timebox", ...)` shape. Assert
  `duration` and `body` field positions. Assert no extra
  fields.

- **Timebox rejection.** Verify the compiler rejects `yield*`
  inside the duration argument (TRJ-05). Verify it rejects
  arrow function bodies (TRJ-02) and variable reference
  bodies (TRJ-03).

- **Converge lowering — single-effect probe.** Verify the
  emitted IR is a `timebox` node whose body contains the
  expected Let/Fn/Call/If structure. Verify the `__probe_0`
  Let's value field holds the single external Eval (the
  compiled probe expression). Verify `Ref("__probe_0")`
  appears in both the `call` args (for `until`) and the
  `then` branch (for return on success).

- **Converge lowering — multi-step probe.** Verify the
  `__probe_0` Let's value field holds the full nested Let
  chain (the compiled multi-step probe expression)
  containing multiple external Evals. Verify
  `Ref("__probe_0")` still appears in the `call` args and
  `then` branch — it refers to the final evaluated Val of
  the nested expression, not to any intermediate value.

- **Converge lowering — structural assertions.** Assert:
  `__until_0` Fn body is structural-only; `__poll_0` Fn body
  contains the probe expression and recursive Call;
  `Eval("sleep", ...)` with the interval value precedes the
  recursive call; `if` node uses `condition` field.

- **Converge rejection.** For each invalid form in §4.2,
  verify the compiler emits the expected error code. For
  CRJ-08 and CRJ-09, verify that `yield*` in
  `interval`/`timeout` is rejected.

- **Converge warning.** Verify that an effectless probe emits
  W-CONV-01 as a warning, not an error. Verify the warning
  does not prevent compilation.

- **Free variable resolution.** Verify that outer bindings
  (workflow params, const declarations) appear as free Refs
  in the generated Fn bodies and are resolvable at call
  sites.

### 12.2 Unit Tests — Constructor DSL

- **`Timebox` constructor.** Verify `Timebox(5000, bodyExpr)`
  produces `Eval("timebox", Q({ duration: 5000, body: bodyExpr }))`.

- **`Converge` macro.** Verify `Converge({...})` produces the
  same IR tree as the compiler for an equivalent authored
  form. Compare IR trees structurally. Test with both
  single-effect and multi-step probe expressions. Verify the
  macro places `config.probe` (an Expr) in the `__probe_0`
  Let's value position.

### 12.3 Unit Tests — Kernel

- **Duration evaluation.** Unit-test the `eval_external`
  timebox path: literal duration returns the literal; Ref
  duration looks up the binding; structural Eval duration
  evaluates synchronously; non-numeric raises TypeError;
  negative raises TypeError; NaN raises TypeError.

- **Malformed duration — external Eval.** Verify that if an
  external Eval is present in the duration subtree and
  reaches the kernel (bypassing validation), the kernel
  raises a deterministic error rather than suspending.

- **Body preservation.** Verify that `data.body` in the
  yielded descriptor is the raw Expr (not evaluated).

- **Child ID allocation.** Verify that after a `timebox`
  descriptor is yielded, the parent's `childSpawnCount` has
  advanced by exactly 2. Verify the body child receives
  index N and the timeout child receives index N+1. Verify a
  subsequent child-creating operation receives index N+2.

- **Simultaneous completion (TB-R6).** Configure a test where
  the body task and timeout task both reach terminal states
  before the runtime resumes the parent. Verify the result
  is `{ status: "completed", value: V }` — body outcome
  takes precedence per TB-R6. Verify body child Close is
  `ok`. Verify timeout child Close is `ok` (completed before
  halt; not reclassified per TB-R6a). Replay the journal and
  verify the same `completed` result.

### 12.4 Unit Tests — IR Validation

- **Duration subtree walk.** For each case in §5.1, verify
  the validator accepts or rejects correctly. Verify the
  validator walks the full duration subtree (TIV-05 tests
  depth > 1).

### 12.5 Integration Tests

- **End-to-end timebox.** Author a workflow with `timebox`,
  compile to IR, validate, execute through kernel + runtime,
  verify result and journal.

- **End-to-end converge — single-effect probe.** Same
  pipeline for `converge`. Use a mock agent that returns
  different probe results per call (e.g., `"pending"`,
  `"pending"`, `"ready"`). Verify convergence on 3rd probe.
  Verify the `value` field of the `completed` result is the
  evaluated probe result from the 3rd iteration. Verify
  journal contains 3 probe + 2 `"sleep"` YieldEvents.

- **End-to-end converge — multi-step probe.** Use a probe
  that calls two agents per iteration. Verify convergence.
  Verify the `value` field is the full compound result (e.g.,
  `{ build, tests }`). Verify journal contains the correct
  number of YieldEvents (2 per iteration for probe effects,
  plus interval `"sleep"` effects).

- **Timebox with real latency.** Fixture: timebox with
  duration 100, body calls a mock agent configured with
  500ms response delay. Result is `{ status: "timeout" }`.
  Body child Close is `cancelled`. Timeout child Close is
  `ok`.

- **Converge with real polling.** Fixture: converge with
  interval 100, timeout 5000. Mock agent returns `"pending"`
  for the first 3 calls, then `"ready"`. `until` checks for
  `"ready"`. Result is `{ status: "completed", value: "ready" }`.
  Journal contains 4 probe YieldEvents + 3 `"sleep"` YieldEvents.

- **Dynamic duration from prior effect.** Author
  `const t = yield* Config().get(); yield* timebox(t, ...)`.
  Verify the effect executes first, the Ref resolves to its
  result, and the timebox uses that value.

- **Dynamic interval/timeout from prior effects.** Author
  converge with prior-bound `interval` and `timeout`. Verify
  both values propagate correctly.

- **Timebox inside finally.** Author a workflow with
  `timebox` inside a `finally` block. Verify the timebox
  executes during cleanup. Verify body child and timeout
  child effects are journaled under their own child
  coroutineIds, not under the parent's cleanup coroutineId.

- **Child ID interleaving.** Author a workflow with `spawn`,
  then `timebox`, then `spawn`. Verify the child coroutineIds
  follow the deterministic allocation sequence
  (TB-R2a–TB-R2d): spawn at index 0, timebox body at index
  1, timebox timeout at index 2, second spawn at index 3.

- **Simultaneous completion integration (TB-R6).** Use a
  mock agent that responds instantly (zero latency) with a
  duration of 0. Both body and timeout complete before the
  parent resumes. Verify the result is
  `{ status: "completed", value: V }` — body outcome takes
  precedence per TB-R6. Verify both children have
  `Close(ok)` (TB-R6a). Replay and verify the same result.

- **Composition integration.** Test `timebox` inside `all`,
  inside `race`, inside `scope`, and inside `try/catch`.
  Test `converge` inside these same contexts.

### 12.6 Replay and Crash Tests

- **Replay fidelity.** Execute a workflow → capture journal →
  replay from journal → verify identical result and identical
  journal trace.

- **Crash during timebox body.** Fixture: timebox with
  duration 5000, body calls one agent. Kill the execution
  host while the body's agent effect is pending (after its
  YieldEvent is persisted but before the response arrives).
  Restart. The body child's YieldEvent replays from journal.
  The agent responds live. The body completes. Result is
  `{ status: "completed", value: V }`. Timeout child Close
  is `cancelled`.

- **Crash during converge polling — between iterations.**
  Kill the host after a completed `"sleep"` but before the
  next probe. Restart. Verify all prior effects replay. Next
  probe executes live.

- **Crash during converge polling — within a multi-step
  probe.** Kill the host after the first probe effect within
  an iteration but before the second. Restart. Verify the
  first probe effect replays. The second executes live. The
  evaluated probe result is the same because the same effect
  results are fed to the kernel.

- **Crash during interval `"sleep"`.** Kill the host while
  the interval `"sleep"` effect is pending. Restart. Verify
  the `"sleep"` replays and the next probe executes live.

- **Crash after timebox completes.** Fixture: timebox with
  duration 5000, body returns a value. Kill the host after
  body child Close(ok) and timeout child Close(cancelled) are
  written but before the parent's next effect. Restart. The
  parent replays, the timebox children's Closes are in the
  journal, and the parent resumes with
  `{ status: "completed", value: V }`. The parent's next
  effect executes live.

- **Journal truncation.** Fixture: timebox with duration 5000,
  body calls two sequential agents. Simulate a partial
  journal write: the first body YieldEvent is fully persisted,
  the second is truncated (crash between persist and
  acknowledge). On restart, the first body effect replays
  from its stored YieldEvent. The second effect executes
  live. The body completes. Result is
  `{ status: "completed", value: V }`. The replayed journal
  contains both YieldEvents (the second now fully persisted).

### 12.7 Performance and Journal Volume

- **Journal volume — timebox (completion, single-effect body
  fixture).** Using a fixture whose body contains exactly one
  external effect: verify the completion case produces 1
  body-child YieldEvent plus CloseEvents. The timeout child
  `"sleep"` YieldEvent is not produced because the body
  completed first.

- **Journal volume — timebox (timeout, single-effect body
  fixture).** Using the same fixture: verify the timeout
  child produces 1 `"sleep"` YieldEvent. The body child
  produces however many YieldEvents occurred before
  cancellation — for this fixture at most 1, but the general
  rule is that the body child may produce zero or more
  YieldEvents depending on how far execution progressed
  before the timeout fired.

- **Journal volume — converge with single-effect probe.**
  Measure journal entries for converge with 500ms interval
  and 30s timeout, single-effect probe. Verify ≤ 120
  YieldEvents (60 probes + 60 `"sleep"` effects at worst).

- **Journal volume — converge with multi-step probe (N
  effects per iteration).** Verify entries per iteration = N
  (probe effects) + 1 (`"sleep"`), except last converging
  iteration = N (no `"sleep"`). Verify total is consistent
  with iteration count × (N + 1) minus 1.

- **Journal volume — high-frequency converge.** Measure
  journal entries for converge with 100ms interval and 60s
  timeout. Verify ≤ 1200 entries for single-effect probe.
  Measure write throughput.

- **Concurrent timeboxes.** Spawn 100 concurrent `timebox`
  effects via `all`. Measure execution layer overhead
  relative to 100 concurrent `race` effects.

- **Replay performance.** Replay a workflow with 50
  sequential `converge` operations (each 5 iterations,
  single-effect probe). Measure replay time. Verify linear
  scaling.

### 12.8 Edge Cases

- **Zero-duration timeout, body has pending effects.** Body
  has at least one external effect that has not completed.
  The timeout `"sleep"` with duration 0 completes
  immediately. The body has not reached terminal state.
  Verify result is `{ status: "timeout" }`. Verify body
  child is `Close(cancelled)`.

- **Zero-duration timeout, body completes immediately.** Body
  is pure (no external effects) and returns a value
  immediately. Both children reach terminal state. Verify
  result is `{ status: "completed", value: V }` — body
  outcome takes precedence per TB-R6. Verify both children
  have `Close(ok)` (TB-R6a). Verify replay produces the
  same `completed` result.

- **Very large timeout.** Fixture: timebox with duration
  2^32 (4294967296), body returns immediately. Kernel
  evaluates the duration without overflow. Result is
  `{ status: "completed", value: V }`. The duration value in
  the yielded descriptor is exactly 4294967296.

- **Body returns undefined.** Verify result is
  `{ status: "completed", value: null }`, distinguishable
  from `{ status: "timeout" }`.

- **Body with nested timebox.** Fixture: outer timebox with
  duration 10000. Body contains an inner timebox with
  duration 100 whose body calls a slow agent (never responds
  within 100ms). Inner timebox result is
  `{ status: "timeout" }`. Body continues after inner
  timeout and returns the inner result. Outer timebox result
  is `{ status: "completed", value: { status: "timeout" } }`.
  Inner timebox children are cleaned up before outer body
  continues. All child coroutineIds are distinct (outer body,
  outer timeout, inner body, inner timeout).

- **Converge with interval = 0.** Valid but produces maximum
  journal volume. Verify no infinite loop — each iteration
  still yields the `"sleep"` effect with duration 0, which
  is an effect boundary.

- **Converge where 1st probe satisfies until.** No `"sleep"`
  occurs. Journal has only probe-body YieldEvents from the
  first iteration.

- **Converge probe evaluates to a falsy value that satisfies
  `until`.** E.g., `until: (v) => v === 0`. Probe evaluates
  to `0`. Verify `0` is the convergence value returned in
  `result.value`. (It is the `until` return value `true` that
  is truthy, not the probe result.)

- **Effectless probe.** Probe evaluates to `42` on every
  iteration. `until: (v) => v === 42`. Converge succeeds on
  first iteration. Warning W-CONV-01 was emitted at compile
  time. No probe YieldEvents in journal (probe expression is
  pure). One body-child Close.

- **Multi-step probe where first effect succeeds but second
  throws.** Error propagates. Journal contains the first
  probe-effect YieldEvent (with successful result) and the
  second probe-effect YieldEvent (recording the error result;
  persist-before-resume applies to error outcomes). The probe
  expression evaluation does not complete; no value is bound
  to `__probe_0`; the error propagates through the Call
  chain. Body child Close is `error`. Timeout child Close is
  `cancelled`.

### 12.9 Failure Injection

- **Agent returns error during single-effect probe.** Fixture:
  converge with a probe that calls one agent, `until` always
  returns true, timeout 10000. The agent returns an error
  result on the first call. The error result is journaled
  (persist-before-resume applies to all effect outcomes,
  including errors). The kernel resumes with the error and
  throws. Error propagates through the Call chain, out of the
  timebox body, through timebox to the parent. Body child
  journal contains 1 probe YieldEvent recording the error
  result. Body child Close is `error`. Timeout child Close
  is `cancelled`.

- **Agent hangs indefinitely during probe.** Fixture: timebox
  with duration 100, body calls an agent that never responds.
  Result is `{ status: "timeout" }`. Timeout child Close is
  `ok`. Body child Close is `cancelled` (halted while its
  agent effect was pending). Body child's pending agent
  effect is not in the journal (it never completed).

- **Runtime crash during timebox orchestration — before
  child registration.** The host crashes after the kernel
  yields the timebox descriptor but before the runtime has
  allocated child coroutineIds or written any child journal
  entries. On restart, the parent kernel replays to the
  timebox suspension point and re-yields the descriptor.
  The runtime re-executes the full timebox orchestration
  from scratch. No child coroutineIds appear in the journal.
  The timebox produces the same result as a fresh execution.

- **Runtime crash during timebox orchestration — after child
  registration, body completes on restart.** Fixture: timebox
  with duration 5000, body calls one agent. The host crashes
  after child coroutineIds are allocated and the body child's
  first YieldEvent is persisted, but before the body child
  has received its response. On restart, the body child
  replays its stored YieldEvent and receives the stored
  response. The body completes. Result is
  `{ status: "completed", value: V }`. Timeout child Close
  is `cancelled`. Journal contains the replayed body
  YieldEvent, body Close(ok), and timeout Close(cancelled).

- **Runtime crash during timebox orchestration — after child
  registration, timeout fires on restart.** Fixture: timebox
  with duration 50, body calls a slow agent. The host crashes
  after child coroutineIds are allocated but before any child
  YieldEvents are persisted. On restart, both children
  re-execute from scratch. The timeout fires before the body
  agent responds. Result is `{ status: "timeout" }`. Body
  child Close is `cancelled`. Timeout child Close is `ok`.

- **Concurrent timebox + external cancellation.** Fixture:
  timebox with duration 5000, body calls one agent. The
  parent scope is cancelled while the timebox runtime is
  setting up its children (after child coroutineId allocation
  but before any child effects are dispatched). Both children
  are cancelled. Body child Close is `cancelled`. Timeout
  child Close is `cancelled`. The timebox does not produce a
  result. No child YieldEvents appear in the journal. No
  orphaned child tasks remain after the parent scope
  completes cancellation.

### 12.10 Timeout and Cancellation Race Cases

- **Body completes before cancellation is durable.** The
  body's agent response arrives and the body child's
  YieldEvent and CloseEvent are durably persisted before the
  parent scope's cancellation takes effect. The timebox
  produces a `completed` result. The timeout child is
  cancelled. On replay, the stored body child journal
  entries reconstruct the same `completed` outcome.

- **Cancellation takes effect before body completion is
  durable.** The parent scope's cancellation is processed
  before the body child's terminal YieldEvent is durably
  persisted. The timebox does not produce a result. Both
  children are cancelled. On replay, no body child
  completion entries exist; the timebox replays as
  cancelled.

- **Body finishes finally while timeout is still pending.**
  Fixture: timebox with duration 5000. Body returns value V
  and has a `finally` block that calls a cleanup agent (the
  cleanup completes well before the deadline). The body
  child runs its main code, enters `finally`, the `finally`
  cleanup effect completes, and the body child reaches
  terminal state. The timeout child's `"sleep"` has NOT
  completed (still pending). Result is
  `{ status: "completed", value: V }`. Body child Close is
  `ok`. Timeout child Close is `cancelled` (halted while its
  `"sleep"` was still pending). Body child's `finally`
  YieldEvents appear in the journal under the body child's
  coroutineId.

- **Timeout fires while body's finally is still running.**
  Fixture: timebox with duration 50. Body returns value V
  and has a `finally` block that calls a slow cleanup agent.
  The timeout child's `"sleep"` completes while the body's
  `finally` effects are still running. The body child is NOT
  terminal — a task is not terminal until all code including
  `finally` has completed. Since only the timeout child has
  reached terminal state, this is the non-simultaneous case:
  TB-R4 applies, and the runtime cancels the body child.
  The body child's remaining `finally` effects run as
  cancellation cleanup (TB-R5), then the body child reaches
  terminal state with `Close(cancelled)`. Result is
  `{ status: "timeout" }`. Timeout child Close is `ok` (its
  `"sleep"` completed normally). Body child Close is
  `cancelled` (halted while still running its `finally`).
  Body child's completed `finally` YieldEvents appear in
  the journal under the body child's coroutineId.

- **Body and timeout complete simultaneously (TB-R6).** Both
  children reach terminal state before the parent resumes.
  Verify the result is `{ status: "completed", value: V }` —
  body outcome takes precedence per TB-R6. Verify body child
  Close is `ok`. Verify timeout child Close is `ok` (not
  `cancelled` — it completed before halt). Verify replay
  produces the same `completed` result.

- **Body error and timeout complete simultaneously
  (TB-R6).** The body child throws an error and the timeout
  `"sleep"` also completes before the parent resumes. Verify
  the body error propagates — body outcome takes precedence
  per TB-R6. Verify body child Close is `error`. Verify
  timeout child Close is `ok` (not `cancelled`). Verify
  replay propagates the same error.

- **Converge probe completes simultaneously with timeout.**
  The probe expression evaluates to a satisfying result at
  the same moment the timeout fires. Both the body child
  (which contains the polling loop) and the timeout child
  are terminal. Body outcome takes precedence (TB-R6), so
  the result is `{ status: "completed" }`. Verify replay
  produces the same `completed` result.

---

## 13. Conformance Rule

An implementation passes timebox and converge conformance if
and only if:

1. All Core tier compiler acceptance fixtures produce IR
   conforming to the expected shape.

2. All Core tier compiler rejection fixtures produce a
   diagnostic that identifies the violated constraint
   category.

3. All Core tier IR validation fixtures accept or reject
   correctly per the duration subtree rules.

4. All Core tier runtime behavior fixtures produce the
   expected result status, result value (canonical JSON
   equality), and journal event sequence (per-coroutineId
   canonical JSON equality).

5. All Core tier replay fixtures produce identical results
   and journal traces when replayed from stored journals.

6. All Core tier journaling fixtures satisfy the stated
   journal ordering and content assertions.

7. No Core tier fixture produces an unexpected error, hangs,
   or crashes.

---

## 14. Deferred / Non-Tests

**Probe error retry.** No tests for `onError` handler
behavior. Probe errors propagate in v1.

**Backoff.** No tests for exponential or variable backoff.
Fixed interval only in v1.

**Journal compression.** No tests for compressed or batched
probe journaling. Each effect is individually journaled.

**`converge` as compound external.** No tests for a runtime
`"converge"` compound-external handler. `converge` lowers to
`timebox` + Fn + Call.

**Macro round-trip.** No `print()` round-trip tests for
`Converge`. Macros expand to base constructor trees;
`print()` emits the expanded form (Constructor DSL Spec §12,
constraint C4).
