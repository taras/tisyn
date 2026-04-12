# Tisyn Timebox Specification

**Implements:** Tisyn System Specification

---

## 1. Overview

This document specifies `timebox`, a compound external
operation that constrains a child computation to complete
within a time limit. If the child completes before the
deadline, `timebox` produces a tagged success result
containing the child's value. If the deadline fires first,
`timebox` produces a tagged timeout result and cancels the
child.

`timebox` is Tisyn's canonical timeout substrate. Other
features that require deadline semantics (including
`converge`) are defined in terms of `timebox`.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHALL, SHALL NOT, SHOULD,
SHOULD NOT, and MAY are used as defined in RFC 2119.

---

## 2. Normative Scope

This specification defines:

- The authored syntax for `timebox`
- The IR node shape for `timebox`
- The kernel's evaluation rule for `timebox`
- The runtime's orchestration semantics
- The result shape for success and timeout
- Error propagation behavior
- Cancellation behavior
- Journal ordering rules
- Replay semantics
- Validation rules
- Composition with other compound externals
- Constructor DSL amendment

This specification does NOT define:

- Retry semantics (`timebox` constrains a single attempt)
- Polling or convergence behavior (see §16)
- The runtime's internal orchestration technique (the
  runtime has implementation latitude)

---

## 3. Relationship to Other Specifications

| Document | Relationship |
|---|---|
| System Specification | `timebox` extends the compound external operation set. Journaling rules extend §6. Replay rules extend §7. |
| Kernel Specification | `timebox` is added to `COMPOUND_EXTERNAL_IDS`. A per-ID evaluation rule is added to `eval_external`. |
| Compiler Specification | `timebox` is a new compiler-recognized authored form. Lowering rules are added. |
| Constructor DSL Specification | `Timebox` is a new base constructor in the constructor table (§14). |
| Authoring Layer Specification | `TimeboxResult<T>` type and `timebox` authored form are added. |
| Runtime Specification | `timebox` orchestration handler is added to `driveKernel`. |
| Converge (§16–§21) | `converge` is defined in terms of `timebox` in this document. |
| Scope, Spawn, Resource Specs | `timebox` follows the same compound-external patterns for journaling and child coroutineId allocation. |

---

## 4. Terminology

**Timebox.** A compound external operation that races a child
computation against a timeout deadline and produces a tagged
result indicating which completed first.

**Body.** The child computation expression passed to `timebox`.
It is evaluated in a child kernel created by the runtime.

**Duration.** The timeout deadline in milliseconds. Evaluated
by the kernel to a numeric Val before the descriptor is
yielded to the runtime.

**Tagged result.** The `timebox` result value, which is always
one of `{ status: "completed", value: T }` or
`{ status: "timeout" }`. Timeout is a normal value, not an
error.

**Body child.** The child task running the body expression.

**Timeout child.** The child task running the timeout `"sleep"`
effect.

**Synchronous expression.** An Expr that the kernel can
evaluate without suspending: literals, Refs, Fn nodes, and
structural Eval nodes whose operands are themselves
synchronous expressions. An Expr containing an external Eval
node is NOT a synchronous expression.

---

## 5. Authored Syntax

### 5.1 Form

```typescript
const result = yield* timebox(<durationExpr>, function* () {
  // body: any valid workflow code
  const data = yield* Agent().method(args);
  return data;
});
```

`timebox` takes two arguments:

1. `durationExpr` — a numeric value expression. This MUST NOT
   contain `yield*`. If the duration is produced by an effect,
   the author MUST bind it in a prior statement-position
   `yield*` and pass the bound variable.
2. A generator function whose body is the protected
   computation.

### 5.2 Duration from a Prior Effect

If the timeout duration must come from an external source, the
author binds it before the `timebox` call:

```typescript
const timeout = yield* Config().getTimeout();
const result = yield* timebox(timeout, function* () {
  return yield* Agent().method();
});
```

The following is NOT valid authored syntax because `yield*`
appears in argument position:

```typescript
// INVALID — yield* is not allowed in argument position
const result = yield* timebox(yield* Config().getTimeout(), function* () {
  return yield* Agent().method();
});
```

### 5.3 Result Type

`timebox` returns `TimeboxResult<T>`:

```typescript
type TimeboxResult<T> =
  | { status: "completed"; value: T }
  | { status: "timeout" };
```

### 5.4 Authored Usage

```typescript
const result = yield* timebox(5000, function* () {
  const report = yield* ReportService().generate(orderId);
  return report;
});

if (result.status === "completed") {
  yield* Email().send(result.value.summary);
} else {
  yield* Email().send("Report generation timed out");
}
```

### 5.5 `return` Inside Body

`return` inside the generator body returns from the body, not
from the enclosing workflow function. The returned value
becomes the `value` field of the `completed` result. This is
the same behavior as `return` inside `all`, `race`, `scope`,
`spawn`, and `resource` bodies.

---

## 6. IR Form

### 6.1 Node Shape

```json
{
  "tisyn": "eval",
  "id": "timebox",
  "data": {
    "tisyn": "quote",
    "expr": {
      "duration": "<Expr>",
      "body": "<Expr>"
    }
  }
}
```

| Field | Type | Constraint | Description |
|---|---|---|---|
| `duration` | Expr | Synchronous expression | Expression that evaluates to a non-negative numeric Val (milliseconds). MUST NOT contain external Eval nodes. |
| `body` | Expr | Any valid Expr | The child computation. Remains unevaluated in the descriptor; the runtime passes it to a child kernel. |

Both fields are inside the Quote's inner data. After
`unquote`, both are raw Expr nodes.

### 6.2 Set Membership

`"timebox"` is a member of `COMPOUND_EXTERNAL_IDS`:

```
COMPOUND_EXTERNAL_IDS = { "all", "race", "scope", "spawn",
                          "resource", "provide", "timebox" }
```

`"timebox"` is NOT a member of `STRUCTURAL_IDS`.

### 6.3 Duration Expression Restrictions

**TB-IR1.** The `duration` field MUST be a synchronous
expression. Specifically, `duration` MUST be one of:

- A literal (number)
- A Ref
- A Fn node (evaluates to itself, though not useful as a
  duration)
- A structural Eval whose entire operand subtree is itself
  composed of synchronous expressions

**TB-IR2.** The `duration` field MUST NOT contain, at any
depth, an Eval node whose `id` is classified as EXTERNAL.
This restriction ensures the kernel can evaluate `duration`
without suspending.

The `body` field has no such restriction. It is expected to
contain external Eval nodes and is NOT evaluated by the
kernel.

### 6.4 Example: Literal Duration

```json
{
  "tisyn": "eval",
  "id": "timebox",
  "data": {
    "tisyn": "quote",
    "expr": {
      "duration": 5000,
      "body": {
        "tisyn": "eval",
        "id": "report-service.generate",
        "data": [{ "tisyn": "ref", "name": "orderId" }]
      }
    }
  }
}
```

The inner agent call `data: [Ref("orderId")]` is the standard
external data shape — an array of argument expressions. The
Ref is resolved at the external boundary when the kernel runs
`resolve()` at suspension time, not in the IR itself.

### 6.5 Example: Duration from Prior Binding

When the authored code binds a dynamic duration in a prior
statement:

```typescript
const timeout = yield* Config().getTimeout();
yield* timebox(timeout, function* () { ... });
```

The compiled IR places the effect call in a Let, and the
timebox's `duration` field is a Ref to that binding:

```json
{
  "tisyn": "eval",
  "id": "let",
  "data": { "tisyn": "quote", "expr": {
    "name": "timeout",
    "value": {
      "tisyn": "eval",
      "id": "config.getTimeout",
      "data": []
    },
    "body": {
      "tisyn": "eval",
      "id": "timebox",
      "data": { "tisyn": "quote", "expr": {
        "duration": { "tisyn": "ref", "name": "timeout" },
        "body": "<body Expr>"
      }}
    }
  }}
}
```

The external Eval (`config.getTimeout`) is in the Let's
`value` position, outside the timebox node. The timebox's
`duration` is a Ref — a synchronous expression. The kernel's
per-ID evaluation rule (§7) evaluates `Ref("timeout")`
against the environment, producing the numeric Val before the
descriptor is yielded.

---

## 7. Kernel Evaluation Rules

### 7.1 Per-ID Evaluation Rule

The kernel's `eval_external` MUST include a
`timebox`-specific path that evaluates `duration` while
preserving `body` as an unevaluated Expr:

```
eval_external("timebox", D, E):
  inner = unquote(D, E)                   // (1)
  dur_val = eval(inner.duration, E)       // (2)
  descriptor = {                          // (3)
    id: "timebox",
    data: { duration: dur_val, body: inner.body }
  }
  result = YIELD descriptor               // (4)
  return result                           // (5)
```

**Step (1) — unquote.** Strips the outer Quote. Returns
`{ duration: <Expr>, body: <Expr> }`. Both fields are raw
Expr nodes.

**Step (2) — evaluate duration.** The kernel calls
`eval(inner.duration, E)` to produce a Val. If `duration` is
a literal, `eval` returns it immediately. If it is a Ref,
`eval` calls `lookup` and returns the bound value. If it is
a structural Eval (e.g., `Eval("mul", ...)`), `eval`
evaluates it synchronously. The kernel MUST verify the result
is a non-negative number. If it is not, the kernel MUST
raise a TypeError.

**Step (3) — construct descriptor.** The descriptor's
`data.duration` is a Val (number). The descriptor's
`data.body` is an Expr (unevaluated).

**Step (4) — yield.** The kernel yields the descriptor and
suspends.

**Step (5) — resume.** The runtime provides the tagged
result. The kernel resumes and returns it.

### 7.2 Duration Constraint

**TB-K1.** The result of `eval(inner.duration, E)` MUST be a
non-negative numeric Val. If the value is not a number, or is
negative, or is NaN, the kernel MUST raise a TypeError. The
timebox MUST NOT be dispatched to the runtime with an invalid
duration.

### 7.3 Body Is Not Evaluated

**TB-K2.** The kernel MUST NOT evaluate `inner.body`. It
remains as an Expr in the descriptor. The runtime creates a
child kernel to evaluate it.

### 7.4 Malformed Duration — External Eval in Duration

**TB-K3.** If `duration` contains an external Eval node, the
IR is malformed. IR validation (§12) SHOULD reject this
before the kernel encounters it. However, if malformed IR
reaches the kernel and `eval(inner.duration, E)` encounters
an external Eval, the kernel MUST raise a deterministic error
rather than suspending. The kernel MUST NOT yield an effect
descriptor from within duration evaluation. The error MUST
identify the timebox node and the offending external Eval
within the duration subtree.

### 7.5 Precedent

Per-ID evaluation variation is established: `provide` uses
non-Quote-wrapped data so `unquote` evaluates it fully;
`spawn` and `resource` use Quote-wrapped data so `unquote`
preserves child expressions. The `timebox` per-ID rule adds
a selective evaluation step after `unquote`, which is a new
pattern but consistent with the existing principle that each
compound external defines its own data contract.

---

## 8. Runtime Orchestration

### 8.1 Descriptor Shape Received

The runtime receives:

```
{
  id: "timebox",
  data: {
    duration: <number>,    // Val — resolved by the kernel
    body: <Expr>           // Expr — unevaluated child
  }
}
```

Plus the parent's environment via the existing
compound-external mechanism.

### 8.2 Orchestration Steps

**TB-R1.** The runtime MUST read `data.duration` as a numeric
value. The runtime MUST NOT evaluate it — it is already a
resolved Val.

**TB-R2.** The runtime MUST allocate exactly two child
coroutineIds for each `timebox` invocation, using the
deterministic child-ID allocation scheme (invariant I-ID).

**TB-R2a.** The body child MUST be allocated first, receiving
child index N (where N is the parent's current
`childSpawnCount` value at the moment the `timebox` descriptor
is received).

**TB-R2b.** The timeout child MUST be allocated second,
receiving child index N+1.

**TB-R2c.** The parent's `childSpawnCount` MUST advance by
exactly 2 after a `timebox` allocation. Subsequent
child-creating operations (other `timebox`, `all`, `race`,
`spawn`, `scope`, `resource` invocations) continue from N+2.

**TB-R2d.** The resulting child coroutineIds are:

- Body child: `parentCoroutineId.N`
- Timeout child: `parentCoroutineId.N+1`

This allocation order is normative. It MUST be identical
between live execution and replay. It MUST NOT depend on
runtime scheduling order, task creation timing, or any other
non-deterministic factor.

**TB-R3.** The runtime MUST create two child tasks:

- **Body task.** A child kernel evaluating `data.body` with
  the parent's environment.
- **Timeout task.** A child kernel evaluating a single
  external effect: `Eval("sleep", [data.duration])`. That is,
  the timeout child dispatches the built-in external effect
  with id `"sleep"` and data `[<duration>]`, where
  `<duration>` is the resolved numeric Val. This is the same
  `"sleep"` effect that the authored `yield* sleep(N)`
  compiles to. The runtime constructs this effect internally —
  it does not appear in the authored IR.

**TB-R4.** The runtime orchestrates first-to-complete
semantics. When one child reaches terminal state while the
other is still running:

- If the **body** completes with value V: cancel the timeout
  child. Resume the parent kernel with
  `{ status: "completed", value: V }`.
- If the **body** throws error E: cancel the timeout child.
  Throw E to the parent kernel. The error is NOT wrapped in
  the tagged result.
- If the **timeout** completes (the `"sleep"` effect
  resolves): cancel the body child. Resume the parent kernel
  with `{ status: "timeout" }`.

**TB-R5.** When the losing child is cancelled (halted while
still running), its `finally` effects MUST run and MUST be
journaled under its child coroutineId. Its CloseEvent MUST be
written with close reason `cancelled`.

### 8.3 Simultaneous Completion

**TB-R6. Body outcome takes precedence.** When both the body
child and the timeout child have reached terminal states
before the runtime resumes the parent kernel, the body
child's outcome takes precedence. The `timebox` result is
determined by the body's outcome:

- If the body completed with value V: the `timebox` result
  is `{ status: "completed", value: V }`.
- If the body threw error E: the error propagates through
  `timebox` to the parent.

The timeout child's outcome is not used. It retains its
actual close reason (`Close(ok)` because it completed) but
its result does not influence the `timebox` outcome.

This is a semantic rule of the `timebox` operation, not a
scheduling property or an implementation detail.
Implementations MAY use any internal technique to detect
child terminal states; the normative requirement is that the
body outcome takes precedence when both children are
terminal.

**TB-R6a. Close reasons are never retroactively
reclassified.** Once a child task has reached terminal state
and its CloseEvent has been written to the journal, its close
reason MUST NOT be changed. A child that completed with
`Close(ok)` remains `Close(ok)` regardless of whether it was
the winner or the loser of the `timebox` arbitration. A child
is recorded as `Close(cancelled)` only if `halt()` was called
while it was still running.

### 8.4 Implementation Latitude

The runtime MAY implement timebox orchestration using the
same internal machinery that powers `race`. This is an
implementation technique, not a semantic equivalence. The
runtime MUST produce the observable behavior specified in
TB-R1 through TB-R6a regardless of internal technique.

### 8.5 Child Allocation Example

> **Non-normative.** This example illustrates deterministic
> child ID allocation when `timebox` is interleaved with
> other child-creating operations.

Consider a workflow where the parent scope creates a `spawn`,
then a `timebox`, then another `spawn`:

```typescript
// Authored workflow (parent coroutineId = "root")
const task1 = yield* spawn(function* () { ... });  // child 0
const result = yield* timebox(5000, function* () {  // children 1, 2
  return yield* Agent().work();
});
const task2 = yield* spawn(function* () { ... });  // child 3
```

The child allocation is:

| Operation | childSpawnCount before | Allocated IDs | childSpawnCount after |
|---|---|---|---|
| `spawn` (task1) | 0 | `root.0` | 1 |
| `timebox` | 1 | `root.1` (body), `root.2` (timeout) | 3 |
| `spawn` (task2) | 3 | `root.3` | 4 |

The `timebox` consumes indices 1 and 2. The subsequent
`spawn` starts at index 3. This ordering is deterministic
and identical on replay.

Note: child allocation order (TB-R2a–TB-R2d) determines
coroutineId assignment. Winner selection when both children
are terminal (TB-R6) is a separate semantic rule. The body
child receives the lower index because it is allocated first,
but the body-precedence rule in TB-R6 is defined as a
semantic property of `timebox`, not as a consequence of
index ordering.

---

## 9. Result Semantics

### 9.1 Success

When the body completes before the deadline, `timebox`
returns:

```json
{ "status": "completed", "value": "<V>" }
```

Where V is the body's return value. If the body returns
`undefined`, the result is
`{ "status": "completed", "value": null }`.

### 9.2 Timeout

When the deadline fires before the body completes, `timebox`
returns:

```json
{ "status": "timeout" }
```

**TB-S1.** Timeout is a normal value. Timeout MUST NOT be
represented as a thrown error. Timeout MUST NOT trigger
`catch` in an enclosing `try/catch`.

### 9.3 Inner Error

If the body throws an error before the deadline, the error
propagates through `timebox` to the parent kernel as a thrown
error. The error is NOT wrapped in the tagged result.

**TB-S2.** `try/catch` around `timebox` catches inner errors.
`try/catch` does NOT catch timeouts (because timeouts are
normal values).

```typescript
// Authored example — handling both timeout and error
try {
  const result = yield* timebox(5000, function* () {
    return yield* Agent().riskyOp();
  });
  if (result.status === "timeout") {
    // handle timeout (not an error)
  } else {
    // use result.value
  }
} catch (e) {
  // handles errors thrown by riskyOp,
  // NOT timeouts
}
```

### 9.4 Cancellation

If the enclosing scope is cancelled while `timebox` is
executing:

**TB-S3.** Both the body child and the timeout child MUST be
cancelled via task-tree cancellation.

**TB-S4.** Their `finally` effects MUST run and MUST be
journaled.

**TB-S5.** The `timebox` does not produce a result.
Cancellation propagates upward to the parent.

---

## 10. Replay Semantics

### 10.1 Replay Reconstruction

On replay, the kernel re-evaluates the IR. When it encounters
the `timebox` Eval node:

**TB-RP1.** The kernel yields the same descriptor
(deterministic from the immutable IR, property P5, and
deterministic duration evaluation).

**TB-RP2.** The runtime allocates the same child coroutineIds
(deterministic allocation, invariant I-ID).

**TB-RP3.** The runtime drives the body child kernel, which
replays stored effects from the journal under the body's
coroutineId.

**TB-RP4.** The runtime drives the timeout child, which
replays its `"sleep"` effect from the journal under the
timeout child's coroutineId.

**TB-RP5.** Replay reconstructs the same child terminal
states from the stored journal entries. The runtime then
applies the same winner-selection logic:

- If exactly one child reached terminal state while the other
  was still running, the terminal child's outcome determines
  the result (same as live execution, because the journal
  records the same effect sequence).
- If both children reached terminal state before parent
  resumption, the body-precedence rule (TB-R6) applies: the
  body's outcome determines the `timebox` result.

In either case, the losing child's close reason is preserved
from the journal — `Close(cancelled)` if it was halted while
running, `Close(ok)` if it had already completed (TB-R6a).
Cleanup effects for cancelled children replay from their
journal entries.

**TB-RP6.** The runtime resumes the parent kernel with the
same tagged result.

### 10.2 Result Reconstruction

The tagged result is NOT directly stored in the parent's
journal. It is deterministically reconstructable from the
children's journal entries. This follows the same pattern as
`all` and `race`, whose results are reconstructed from their
children's outcomes.

### 10.3 Divergence

If the body child's replay produces a different effect
sequence than its stored journal entries (because the IR
changed between executions), standard divergence handling
applies (Kernel Specification §10.4). Divergence is fatal.

---

## 11. Journal Rules

### 11.1 No Parent YieldEvent

**TB-J1.** A `timebox` compound external MUST NOT advance the
parent's yieldIndex and MUST NOT produce a YieldEvent in the
parent's durable stream.

Rationale: `timebox` is structural orchestration from the
parent's perspective. The parent kernel yields a single
descriptor and receives a single result. Internal mechanics
are journaled under child coroutineIds. This follows the
established convention for compound externals (Scope Spec
§8.1, Spawn Spec J6, Resource Spec §7.5).

### 11.2 Body Child Effects

**TB-J2.** Effects dispatched by the body child kernel MUST
produce YieldEvents under the body child's coroutineId.
Standard journaling rules apply: persist-before-resume (G3),
monotonic yieldIndex (O3), close-after-yields (O4).

### 11.3 Timeout Child Effect

**TB-J3.** The timeout child's `"sleep"` effect MUST produce
a YieldEvent under the timeout child's coroutineId. The
YieldEvent's description records the effect id `"sleep"` and
the duration value.

### 11.4 Child CloseEvents

**TB-J4.** Both the body child and the timeout child MUST
produce CloseEvents.

- The winning child's Close records its terminal status: `ok`
  with value (body success), or `ok` (timeout `"sleep"`
  completed).
- The losing child's Close records `cancelled` if it was
  still running when halted. If the losing child had already
  completed before halt was called, it retains its actual
  close reason (`ok`) per TB-R6a.

Both Closes MUST precede the parent's continuation (ordering
guarantee O2/O5).

### 11.5 Cleanup Effects

**TB-J5.** If the losing child was cancelled (still running
when halted), cleanup effects from its `finally` blocks MUST
be journaled under its coroutineId. Cleanup effects continue
the same yieldIndex sequence (no reset). This follows the
existing cleanup journaling convention (System Spec §6.6).
If the losing child had already completed before halt, no
cleanup effects are produced — it already ran to completion.

### 11.6 Journal Ownership Is Independent of Placement

**TB-J6.** The journaling rules TB-J1 through TB-J5 apply
regardless of where the `timebox` appears in the enclosing
workflow — including inside `finally` blocks, inside other
compound effect bodies, or at the top level. The body child's
effects are always journaled under the body child's
coroutineId, and the timeout child's effects are always
journaled under the timeout child's coroutineId. The parent
coroutineId is never used for `timebox`-internal effects.

### 11.7 Journal Ordering Example — Body Wins

> **Non-normative.** Normal case — body completes while the
> timeout child is still running.

```
[body-child:    Yield("report-service.generate", yi=0)]
[body-child:    Close(ok, value=V)]
[timeout-child: Close(cancelled)]
→ parent resumes with { status: "completed", value: V }
```

### 11.8 Journal Ordering Example — Timeout Wins

> **Non-normative.** Normal case — timeout fires while the
> body child is still running.

```
[body-child:    Yield("report-service.generate", yi=0)]
  ← body still running when timeout fires
[timeout-child: Yield("sleep", yi=0)]
[timeout-child: Close(ok)]
[body-child:    Close(cancelled)]
→ parent resumes with { status: "timeout" }
```

---

## 12. Validation Rules

### 12.1 IR Validation

**TB-V1.** `"timebox"` MUST be recognized as a compound
external id during validation. The `data` field MUST be a
Quote node.

**TB-V2.** The Quote's inner expr MUST be an object with
exactly two fields: `duration` and `body`. Both MUST be
present. Extra fields are handled per the existing
extra-field policy.

**TB-V3.** `body` MUST be a valid Expr (Literal, Ref, Eval,
Fn, or Quote). No restrictions on what the body contains.

**TB-V4.** `duration` MUST be a valid Expr. Additionally,
`duration` MUST be a synchronous expression: it MUST NOT
contain, at any nesting depth, an Eval node whose `id` would
be classified as EXTERNAL. The validator MUST walk the
`duration` subtree and reject the IR if any external Eval is
found.

> **Non-normative.** The validator walks `duration` using the
> same classification function that the kernel uses (System
> Spec §7.1). If any Eval node in the subtree has an `id`
> not in `STRUCTURAL_IDS`, the IR is malformed.

### 12.2 Compiler Validation

**TB-V5.** The compiler MUST verify that the authored form
`yield* timebox(D, function* () { ... })` has exactly two
arguments.

**TB-V6.** The second argument MUST be a generator function
expression. Non-generator functions, arrow functions, and
variable references MUST be rejected.

**TB-V7.** The duration argument MUST NOT contain `yield*`.
The existing compiler restriction that `yield*` is only valid
in statement position applies. If the author needs a duration
produced by an effect, they MUST bind it in a prior statement
and pass the bound variable. The compiler MUST reject `yield*`
appearing inside the duration argument.

---

## 13. Composition

### 13.1 With `all`

`timebox` inside `all`: the timebox is one branch. It
completes normally (with `completed` or `timeout` result).
The `all` collects its result alongside siblings.

### 13.2 With `race`

`timebox` inside `race`: if the timebox resolves first
(either way), it wins the race.

### 13.3 With `spawn`

`spawn` inside `timebox` body: spawned tasks are cancelled
when the body is cancelled (on timeout or external
cancellation).

### 13.4 With `try/catch/finally`

`timebox` inside `try/catch`: inner errors are caught;
timeout results are not (§9.3).

`timebox` inside `finally`: `timebox` MAY appear inside a
`finally` block in authored workflow code. When it does, the
enclosing task reaches the `timebox` compound suspension
point during cleanup execution. The parent cleanup coroutine
remains suspended while the runtime orchestrates the
`timebox` body child and timeout child. The body child's
effects are journaled under the body child's coroutineId.
The timeout child's `"sleep"` effect is journaled under the
timeout child's coroutineId. These child coroutineIds are
allocated by the runtime per TB-R2 — they are NOT the
parent's coroutineId. Once both children reach terminal
states per the `timebox` rules (TB-R4, TB-R5, TB-R6), the
parent cleanup coroutine resumes with the tagged result and
continues the `finally` block's remaining expressions.

Placement inside `finally` does not change the `timebox`
journaling model. TB-J1 through TB-J6 apply identically.

### 13.5 Nesting

`timebox` inside `timebox`: the inner timebox resolves
independently. Its timeout does not affect the outer timebox
directly — only through the inner timebox's result.

---

## 14. Constructor DSL Amendment

### 14.1 Constructor Table Amendment

The constructor DSL specification's constructor table is a
closed, statically defined vocabulary. This specification
amends that table by adding one entry.

**Amendment.** Add the following row to the constructor table:

| Name | Category | Arity | Parameters | IR produced |
|---|---|---|---|---|
| `Timebox` | Base constructor | 2 | `duration: Expr`, `body: Expr` | `Eval("timebox", Quote({ duration, body }))` |

`Timebox` is a base constructor. It maps 1:1 to an IR Eval
node with id `"timebox"`, following the same pattern as
existing base constructors (`Let`, `If`, `Call`, etc.). Both
parameters are Expr nodes. The constructor wraps them in a
Quote with fields `duration` and `body`, producing the IR
shape defined in §6.1.

Implementations MUST NOT expose `Timebox` in the constructor
DSL until this amendment is adopted.

### 14.2 Reference Expansion

For clarity, the expansion produced by `Timebox(D, B)` is:

```json
{
  "tisyn": "eval",
  "id": "timebox",
  "data": {
    "tisyn": "quote",
    "expr": {
      "duration": "D",
      "body": "B"
    }
  }
}
```

Where D and B are the Expr trees passed as `duration` and
`body` respectively.

---

## 15. Deferred / Non-Goals

**Retry.** `timebox` constrains a single attempt. Retry logic
must be composed in authored workflow code or via `converge`.

**Grace period.** No cancellation grace period beyond
`finally`. If agents have long in-flight cleanup, that is
handled by the agent's own idempotency, not by `timebox`.

**Backoff.** No built-in backoff. Fixed deadlines only.

**Duration arithmetic.** No built-in duration types or
arithmetic. Duration is a plain number in milliseconds.

---

## 16. Converge

`converge` is an authored workflow form and constructor DSL
macro that implements polling convergence — repeatedly probing
an external system until a condition is met or a timeout
fires.

`converge` is NOT a new IR node. It is NOT a kernel
primitive. It is NOT a runtime operation. The compiler
recognizes `converge` in authored code and lowers it to a
`timebox` node whose body is a recursive Fn + Call polling
loop using existing IR nodes. The constructor DSL provides a
`Converge` macro that performs the same expansion.

### 16.1 Normative Scope

This section defines:

- The relationship between `converge` and `timebox`
- The lowering strategy from authored form to IR
- Result semantics
- Replay and journaling consequences

This section does NOT define:

- Any new IR node type
- Any new kernel evaluation rule
- Any new runtime orchestration behavior
- Journal compression or compound-level journaling

### 16.2 Relationship to `timebox`

`converge` is defined in terms of `timebox`:

- The timeout behavior of `converge` IS `timebox` timeout
  behavior (§9.2).
- The result type of `converge` IS `TimeboxResult<T>`
  (§5.3).
- The cancellation behavior of `converge` IS `timebox`
  cancellation behavior (§9.4).
- The journaling of `converge` IS the journaling of the
  `timebox` body's effects — probe effects and interval
  sleeps (§11).
- The replay of `converge` IS the replay of the enclosing
  `timebox` (§10).

`converge` adds one concept on top of `timebox`: a polling
loop with a `probe`/`until` split inside the body.

---

## 17. Converge Lowering Strategy

### 17.1 Conceptual Model

> **Non-normative.** The following pseudocode shows the
> logical structure of the lowered form. The actual IR uses
> the Fn + Call recursive pattern, not generator syntax.

```
timebox(timeout, function* () {
  function* __poll() {
    const probeResult = yield* probe();
    if (until(probeResult)) {
      return probeResult;
    }
    yield* sleep(interval);
    return yield* __poll();
  }
  return yield* __poll();
})
```

### 17.2 Lowered IR — Constructor Function Notation

The authored form:

```typescript
yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: 500,
  timeout: 10_000,
});
```

Lowers to the following IR tree, shown in `@tisyn/ir`
constructor function notation (not DSL parser input text):

```
Timebox(10000,
  Let("__until_0",
    Fn(["v"], Eq(Get(Ref("v"), "state"), "ready")),
  Let("__poll_0",
    Fn([],
      Let("__probe_0",
        Eval("deployment.status", [Ref("deployId")]),
      If(
        Call(Ref("__until_0"), Ref("__probe_0")),
        Ref("__probe_0"),
        Let("__discard_0",
          Eval("sleep", [500]),
          Call(Ref("__poll_0")))))),
  Call(Ref("__poll_0")))))
```

> **Notation.** Named calls — `Timebox`, `Let`, `Fn`, `Eval`,
> `If`, `Call`, `Ref`, `Eq`, `Get` — are `@tisyn/ir`
> constructor functions. `Timebox` is the base constructor
> defined in §14; the rest are existing constructors.
> `Call` is variadic: `Call(fn, arg₁, ..., argₙ)`. Bracketed
> values `[Ref("deployId")]` and `[500]` are raw JSON array
> literals — plain Tisyn Literal expressions (System
> Specification §3.5), NOT `Arr(...)` constructor calls.
> `Arr(...)` produces an `Eval("array", ...)` IR node, which
> is structurally different from a raw array. Effect data for
> external Eval nodes MUST be a raw array.

**Reading the `__probe_0` Let.** The Let's value position
holds the compiled probe expression — in this example,
`Eval("deployment.status", [Ref("deployId")])`. When the
kernel evaluates this Let, it evaluates the probe expression
(dispatching the external effect, receiving the journaled
result), and binds the resulting Val to the name
`__probe_0`. All subsequent references to
`Ref("__probe_0")` in the Let body refer to this evaluated
result, not to the expression tree.

### 17.3 Lowered IR — Full JSON

The same tree in actual Tisyn JSON IR:

```json
{
  "tisyn": "eval",
  "id": "timebox",
  "data": { "tisyn": "quote", "expr": {
    "duration": 10000,
    "body": { "tisyn": "eval", "id": "let", "data": {
      "tisyn": "quote", "expr": {
        "name": "__until_0",
        "value": { "tisyn": "fn", "params": ["v"],
          "body": { "tisyn": "eval", "id": "eq", "data": {
            "tisyn": "quote", "expr": {
              "a": { "tisyn": "eval", "id": "get", "data": {
                "tisyn": "quote", "expr": {
                  "obj": { "tisyn": "ref", "name": "v" },
                  "key": "state" }}},
              "b": "ready" }}}},
        "body": { "tisyn": "eval", "id": "let", "data": {
          "tisyn": "quote", "expr": {
            "name": "__poll_0",
            "value": { "tisyn": "fn", "params": [],
              "body": { "tisyn": "eval", "id": "let", "data": {
                "tisyn": "quote", "expr": {
                  "name": "__probe_0",
                  "value": { "tisyn": "eval",
                    "id": "deployment.status",
                    "data": [{ "tisyn": "ref",
                      "name": "deployId" }] },
                  "body": { "tisyn": "eval", "id": "if",
                    "data": { "tisyn": "quote", "expr": {
                      "condition": { "tisyn": "eval",
                        "id": "call",
                        "data": { "tisyn": "quote", "expr": {
                          "fn": { "tisyn": "ref",
                            "name": "__until_0" },
                          "args": [{ "tisyn": "ref",
                            "name": "__probe_0" }] }}},
                      "then": { "tisyn": "ref",
                        "name": "__probe_0" },
                      "else": { "tisyn": "eval", "id": "let",
                        "data": { "tisyn": "quote", "expr": {
                          "name": "__discard_0",
                          "value": { "tisyn": "eval",
                            "id": "sleep",
                            "data": [500] },
                          "body": { "tisyn": "eval",
                            "id": "call",
                            "data": { "tisyn": "quote",
                              "expr": {
                                "fn": { "tisyn": "ref",
                                  "name": "__poll_0" },
                                "args": [] }}}
                          }}}
                      }}}
                  }}}
              }},
            "body": { "tisyn": "eval", "id": "call",
              "data": { "tisyn": "quote", "expr": {
                "fn": { "tisyn": "ref", "name": "__poll_0" },
                "args": [] }}}
          }}}
      }}}
  }}
}
```

### 17.4 Multi-Step Probe Lowering

When the probe body contains multiple effects, the compiler
compiles the entire probe generator body as a single Expr
tree and places it in the `__probe_0` Let's value position.
For example:

```typescript
probe: function* () {
  const build = yield* CI().getBuild(buildId);
  const tests = yield* CI().getTestResults(build.testRunId);
  return { build, tests };
}
```

The probe body compiles to a nested Let chain (the same
lowering the compiler applies to any multi-statement
generator body), shown in constructor function notation
(see §17.2 notation note):

```
Let("build",
  Eval("ci.getBuild", [Ref("buildId")]),
Let("tests",
  Eval("ci.getTestResults", [Get(Ref("build"), "testRunId")]),
  Construct({
    "build": Ref("build"),
    "tests": Ref("tests") })))
```

> `[Ref("buildId")]` is a raw JSON array (effect data),
> not an `Arr(...)` call. `Construct({...})` is a base
> constructor (Constructor DSL Specification §4.3) that
> produces an `Eval("construct", ...)` IR node — this is
> correct here because the probe body constructs a runtime
> object.

This entire expression tree occupies the `__probe_0` Let's
value position. When the kernel evaluates this Let, it
evaluates the nested expression — dispatching each external
effect in sequence, receiving each journaled result — and
binds the final evaluated Val (the constructed
`{ build, tests }` object) to the name `__probe_0`. The
`until` Fn then receives this evaluated Val, not the
expression tree.

### 17.5 How the Lowering Works

**`__until_0`.** Bound to a Fn compiled from the `until`
arrow function. The Fn body is pure structural IR (`Eq`,
`Get`). It is called via the `call` structural operation,
which passes the evaluated probe result as the argument. No
journal entry is produced.

**`__poll_0`.** Bound to a recursive Fn with no parameters.
This is the Case B pattern (Compiler Specification §6.2).
The Fn body contains external effects (the probe expression
and the `"sleep"` effect), which cross the execution
boundary normally when the kernel evaluates the Fn body via
`eval_call` (Architecture §5.4).

**`Call(Ref("__poll_0"))` (outer).** Starts the first
iteration. `Ref("__poll_0")` resolves via call-site
resolution — the caller's environment contains the
`Let("__poll_0", Fn(...))` binding.

**Each iteration:**

1. **Evaluate probe expression.** The kernel evaluates the
   `__probe_0` Let's value expression. Each external Eval
   within the probe expression causes the kernel to suspend,
   yield a descriptor, receive a journaled result, and
   resume. A single-effect probe produces one YieldEvent. A
   multi-step probe produces one YieldEvent per external
   effect. The final evaluated Val is bound to the name
   `__probe_0`.

2. **Call until.** `Call(Ref("__until_0"), Ref("__probe_0"))`
   is structural. The kernel looks up `__probe_0` in the
   environment (obtaining the evaluated probe result Val),
   passes it as the argument to the `__until_0` Fn, and
   evaluates the Fn body synchronously. Returns a
   boolean-interpretable value. No journal entry.

3. **Branch on the `if` condition.**
   - Truthy → the `then` branch is `Ref("__probe_0")`,
     which resolves to the evaluated probe result Val. This
     value propagates out through the Call chain as the Fn's
     return value, becoming the timebox body's result.
   - Falsy → the `else` branch evaluates
     `Eval("sleep", [500])` (the built-in `"sleep"`
     external effect, journaled as a YieldEvent), then
     `Call(Ref("__poll_0"))` recurses.

**Termination:**

- `until` returns truthy → `__poll_0` Fn returns the
  evaluated probe result → timebox body completes →
  `{ status: "completed", value: <evaluated probe result> }`.
- Timebox deadline fires → body task cancelled → recursive
  call chain halted → `{ status: "timeout" }`.
- Probe expression throws → error propagates through Call
  chain → timebox body throws → error propagates through
  timebox.

### 17.6 Why Fn + Call Is Valid

The compiler-generated `__poll_0` Fn contains effects. The
Compiler Specification §8.5 restricts user-authored arrow
function Fn bodies from containing effects, but
compiler-generated Fn nodes for Case B lowering are
established precedent — the same mechanism is used for
`while`-with-`return` (Compiler Specification §6.2) and
stream iteration. The kernel's `eval_call` handles effects
in Fn bodies by suspending at external Eval nodes regardless
of nesting depth.

### 17.7 No New IR Nodes

This lowering uses only existing IR nodes: `Eval`, `Let`,
`Fn`, `Call`, `If`, `Ref`, `Eq`, `Get`, `Quote`, and
`timebox` (§6). No `continue`, `break`, `converge`, or
other new node types are introduced.

---

## 18. Converge Result Semantics

### 18.1 Convergence Success

When the evaluated probe result satisfies `until`,
`converge` returns:

```json
{ "status": "completed", "value": "<evaluated probe result>" }
```

This is a `timebox` `completed` result (§9.1). The `value`
field contains the Val that the probe expression evaluated
to on the satisfying iteration — not the probe expression
tree.

### 18.2 Timeout

When no probe result satisfies `until` within the deadline:

```json
{ "status": "timeout" }
```

This is a `timebox` `timeout` result. Same semantics as
§9.2.

### 18.3 Probe Error

If any external effect within the probe expression throws,
the error propagates through the Fn call chain, out of the
timebox body, through `timebox` to the parent as a thrown
error. Same semantics as §9.3.

Probe errors are NOT retried. A future revision MAY add an
`onError` handler field.

---

## 19. Converge Replay and Journaling

### 19.1 Per-Attempt Journaling

Because `converge` lowers to a `timebox` body containing
standard external effects, each external effect in the probe
expression and each interval `"sleep"` effect is
individually journaled. This is not a design choice — it is
a necessary consequence of crossing the effect boundary.

Each external effect in the probe is a standard effect. The
kernel yields a descriptor for it. The persist-before-resume
invariant (G3) requires the result to be journaled before
the kernel resumes. There is no mechanism to suppress this.

### 19.2 Journal Entries Per Iteration

A single polling iteration produces:

- One YieldEvent per external effect in the probe expression
  (one for a single-effect probe, multiple for a multi-step
  probe)
- One YieldEvent for the interval `"sleep"` effect (if the
  iteration does not converge)

The `until` evaluation is structural and produces no journal
entry.

The total number of YieldEvents for a converge depends on
the number of iterations performed and the number of
external effects in the probe expression. It is NOT a fixed
formula — it varies with the authored probe.

### 19.3 Journal Trace — Single-Effect Probe, Convergence on 3rd Attempt

> **Non-normative.** This trace illustrates a converge with
> a single-effect probe that converges on its third attempt.

```
body-child:    Yield("deployment.status", yi=0)   probe 1
body-child:    Yield("sleep",             yi=1)   interval
body-child:    Yield("deployment.status", yi=2)   probe 2
body-child:    Yield("sleep",             yi=3)   interval
body-child:    Yield("deployment.status", yi=4)   probe 3
  → until satisfied, __poll_0 returns evaluated result
body-child:    Close(ok, value=<status>)
timeout-child: Close(cancelled)
```

### 19.4 Journal Trace — Multi-Step Probe (2 Effects), Convergence on 2nd Attempt

> **Non-normative.**

```
body-child:    Yield("ci.getBuild",       yi=0)   probe 1, effect 1
body-child:    Yield("ci.getTestResults", yi=1)   probe 1, effect 2
body-child:    Yield("sleep",             yi=2)   interval
body-child:    Yield("ci.getBuild",       yi=3)   probe 2, effect 1
body-child:    Yield("ci.getTestResults", yi=4)   probe 2, effect 2
  → until satisfied, __poll_0 returns evaluated result
body-child:    Close(ok, value=<r>)
timeout-child: Close(cancelled)
```

### 19.5 Journal Trace — Timeout

> **Non-normative.**

```
body-child:    Yield("deployment.status", yi=0)   probe 1
body-child:    Yield("sleep",             yi=1)   interval
body-child:    Yield("deployment.status", yi=2)   probe 2
body-child:    Yield("sleep",             yi=3)   interval
  → timeout fires before next probe
timeout-child: Yield("sleep",             yi=0)
timeout-child: Close(ok)
body-child:    Close(cancelled)
```

### 19.6 `until` Is Not Journaled

The `until` predicate is evaluated via the `call` structural
operation. Structural operations produce no journal entries.
On replay, the same probe results are replayed, the same
`until` evaluations occur, and the same boolean results are
produced.

### 19.7 Replay Fidelity

On replay, the timebox body child replays from its journal
entries. Each probe effect's stored result is fed to the
kernel. The kernel evaluates the probe expression, receiving
stored results from the journal for each external effect.
The probe expression evaluates to the same Val on each
iteration. The kernel evaluates `until` against each
evaluated probe result. The same probe result satisfies
`until` on the same iteration. The same number of `"sleep"`
effects occur. The timebox resolves identically.

### 19.8 Crash Recovery

If the host crashes mid-polling:

- All completed probe effects and interval sleeps are in the
  journal (persist-before-resume).
- On restart, the runtime replays the timebox body child,
  fast-forwarding through stored effects.
- Live execution resumes at the first un-journaled effect
  (the next probe effect or `"sleep"`).
- No completed work is lost.

If the probe is multi-step and the crash occurs between
external effects within a single iteration (e.g., after
`"ci.getBuild"` but before `"ci.getTestResults"`), the first
probe effect replays from journal and the second executes
live. This is the standard partial-replay behavior.

---

## 20. Converge Examples

### 20.1 Polling a Deployment

```typescript
const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: 500,
  timeout: 30_000,
});

if (result.status === "completed") {
  yield* Notify().alert("Deployment ready");
} else {
  yield* Notify().alert("Deployment timed out");
}
```

### 20.2 Waiting for Approval

```typescript
const result = yield* converge({
  probe: function* () {
    return yield* ApprovalService().check(requestId);
  },
  until: (approval) => approval.decision !== "pending",
  interval: 2000,
  timeout: 60_000,
});
```

### 20.3 Multi-Step Probe

```typescript
const result = yield* converge({
  probe: function* () {
    const build = yield* CI().getBuild(buildId);
    const tests = yield* CI().getTestResults(build.testRunId);
    return { build, tests };
  },
  until: (r) => r.build.status === "complete" && r.tests.passed,
  interval: 5000,
  timeout: 120_000,
});
```

### 20.4 Dynamic Interval and Timeout

```typescript
const pollInterval = yield* Config().pollInterval();
const deadline = yield* Config().timeout();

const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: pollInterval,
  timeout: deadline,
});
```

---

## 21. Converge Deferred / Non-Goals

**Error retry.** Probe errors propagate. A future revision
MAY add an `onError` handler field to allow retry-on-error
without changes to the IR model.

**Backoff.** Fixed interval only. Exponential backoff can be
added later without IR model changes (the `interval`
expression position already accepts any synchronous
expression).

**Journal compression.** Explicitly rejected.
Per-attempt journaling is a necessary consequence of
crossing the effect boundary. Each probe effect and each
interval sleep is a standard effect with its own YieldEvent.
There is no mechanism to suppress or batch these entries.

**`converge` as a compound external.** Explicitly rejected.
The polling loop is transparent authored/compiler logic, not
runtime-internal orchestration. The runtime sees only the
enclosing `timebox` and its children.

**`always`.** The stability-assertion primitive (from
Effection's test utilities) is excluded from core Tisyn. It
is a test-only concept with no durable-execution analog.

**`when`.** The testing-style "retry until assertion stops
failing" pattern is replaced by `converge` with explicit
`probe`/`until` split. The split makes the observation step
and the success predicate independently visible in the IR
and individually testable.
