# Tisyn Spawn Specification

**Implements:** Tisyn System Specification
**Amends:** Tisyn Kernel Specification, Tisyn Compiler Specification
**Depends on:** Tisyn Blocking Scope Specification, Tisyn Compound Concurrency Specification

---

## 1. Overview

This specification defines non-blocking child scope creation
for authored Tisyn workflows via `spawn(...)`. A spawned child
scope runs concurrently with its parent. The parent receives
a task handle, which it may bind in a local variable, and
continues executing immediately. The parent may later join the
task to obtain its return value. The child's lifetime is
bounded by the parent's scope — it is halted when the parent
scope exits.

`spawn(...)` is the second scope-creating operation, after
blocking `scoped(...)`. It reuses the scope substrate
established by the blocking-scope specification: the
distinguished semantic form, scope metadata model, child
coroutineId allocation, runtime-owned lifecycle, and replay
reconstruction from IR.

The target authored surface is:

````typescript
// Fire-and-forget
yield* spawn(function* () {
  // background work
});

// Bind and join
const task = yield* spawn(function* () {
  const coder = yield* useAgent(Coder);
  return yield* coder.implement(spec);
});
const result = yield* task;
````

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- authored-language rules for `spawn(...)` and task join
- the `spawn` and `join` distinguished IR forms
- kernel evaluation rules for `spawn` and `join`
- runtime spawn lifecycle: non-blocking child creation, task
  handle provision, join semantics, failure propagation, and
  teardown
- journal ordering for concurrent parent-child execution
- replay semantics for spawned children and joins

### 1.3 Relationship to Other Specifications

This specification amends the kernel specification by adding
`"spawn"` and `"join"` to the compound-external ID set. It
amends the compiler specification by adding `spawn`-related
authoring constructs and task-handle tracking.

It builds on the blocking-scope specification for scope
metadata, handler installation, binding evaluation, and
child coroutineId allocation. It builds on the compound
concurrency specification for per-coroutineId replay cursors,
journal ordering rules, and structured concurrency integration
with Effection.

### 1.4 Key Design Decisions

This MVP makes the following concrete choices:

- `yield* spawn(fn)` returns a task handle. The parent may
  bind the handle in a local `const` variable and later join
  it. Handles MUST NOT be passed as arguments, returned, or
  stored in compound values.
- `yield* handle` joins the spawned child: it suspends the
  parent until the child completes, then produces the child's
  return value.
- If a spawned child fails, its error propagates to the parent
  scope unconditionally. This tears down the scope regardless
  of whether the parent has bound a task handle, regardless of
  whether a join exists in the code, and regardless of whether
  the parent has reached the join point. There is no schedule-
  sensitive joined/unjoined distinction. See §6.4 for the
  precise rule.
- The existing per-coroutineId replay cursor model is
  sufficient for concurrent parent-child interleaving.
- Spawn index is assigned at spawn time from the parent's
  unified `childSpawnCount`.
- No new durable event types are introduced. Spawn and join
  are structural runtime operations, not journaled effects.

---

## 2. Terminology

**Spawned child.** A child scope created by `spawn(...)` that
executes concurrently with its parent. The child is background
work from the structured concurrency perspective — its result
is not automatically consumed by the parent's foreground
computation.

**Task handle.** A capability value returned by `spawn(...)`.
A capability value is a restricted subclass of `Val` with the
following properties:

- It MAY be bound in the kernel environment via `Let` and
  referenced via `Ref`.
- It MUST NOT be serialized, stored in the journal, included
  in effect data passed to agents, returned as a workflow
  result, or included in compound values (objects, arrays).
- It is ephemeral: it exists only during one execution. On
  replay, the runtime reconstructs a semantically equivalent
  capability value at the same program point.

The only operation permitted on a task handle after binding is
join: `yield* handle`.

**Join.** The operation of waiting for a spawned child to
complete successfully and obtaining its return value. Expressed
as `yield* handle` where `handle` is a variable bound by a
`spawn(...)` expression. Join is a completion wait and value
extraction — it is not an error-delivery mechanism.

**Background work.** Work whose result is not automatically
consumed by the parent's foreground computation. A spawned
child's result is available only if the parent explicitly
joins it.

---

## 3. Authored-Language Rules

### 3.1 Accepted Form

The compiler MUST accept the following authored forms:

````typescript
// Fire-and-forget: bare statement
yield* spawn(function* () { ... });

// Capture task handle
const task = yield* spawn(function* () { ... });
````

The argument to `spawn` MUST be a generator function expression
(a `FunctionExpression` with an asterisk token). Arrow
functions, non-generator functions, and identifiers MUST be
rejected.

`yield* spawn(...)` MUST appear in statement position only,
consistent with the existing `yield*` rule.

### 3.2 Return Value and Binding

`yield* spawn(fn)` produces a task handle (§2).

SP1. `yield* spawn(fn)` MAY appear as:
     - a bare expression statement (fire-and-forget — the
       handle is discarded):
       `yield* spawn(function* () { ... });`
     - the initializer of a `const` declaration:
       `const task = yield* spawn(function* () { ... });`

SP2. `yield* spawn(fn)` MUST NOT appear as the initializer
     of a `let` declaration. Task handles MUST NOT be
     reassigned.

### 3.3 Spawn Handle Join

`yield* <spawn-handle>` is a distinguished authored form. It
means: suspend the parent until the spawned child completes
successfully, then produce the child's return value.

This form is semantically distinct from `yield*` targeting an
agent call, an `all`, a `race`, a `scoped`, or another `spawn`.
The compiler recognizes it by checking whether the `yield*`
target is a variable bound by a `spawn(...)` expression.

SP3. After initial binding, the ONLY permitted use of a spawn
     handle variable is `yield* handle`. No other expression
     involving the handle is accepted.

     If the handle was not bound (fire-and-forget per SP1),
     there is no variable to use — the child runs to completion
     or failure without explicit join.

SP4. A spawn handle MUST NOT be passed as an argument to agent
     calls, returned from the workflow, stored in data
     structures (objects, arrays), or used in any expression
     other than `yield* handle`.

SP5. `yield* handle` MAY appear as:
     - a bare expression statement: `yield* task;`
     - the initializer of a `const` or `let` declaration:
       `const result = yield* task;`
     - a return expression: `return yield* task;`

SP6. A spawn handle MAY be joined at most once. The compiler
     SHOULD reject a second `yield* handle` for the same
     binding if statically detectable. If not statically
     detectable, duplicate join is a runtime error.

### 3.4 Placement

SP7. `yield* spawn(fn)` is a body statement. It MUST NOT
     appear in a scope's setup prefix. The compiler MUST
     reject `spawn(...)` that precedes the first body
     statement in a `scoped(...)` block.

SP8. `yield* spawn(fn)` MAY appear inside `if` branches,
     `while` bodies, `try/catch/finally`, and other control
     flow constructs.

### 3.5 Spawned Body Rules

The body of the generator function passed to `spawn(...)` is
a full workflow body.

SP9. The spawned body MAY contain any construct permitted by
     the compiler specification's authoring subset, including
     `yield*` agent calls, `all`, `race`, nested `scoped`,
     and nested `spawn`.

SP10. The spawned body does NOT have its own setup/body
      partition. Setup-before-body applies only inside
      `scoped(...)` blocks within the spawned body.

SP11. Three categories of outer values apply to spawned bodies:

      **A. Ordinary lexical capture.** A spawned body MAY
      reference names that are in scope at the `spawn(...)` call
      site. Specifically, the following are permitted:

      - Workflow parameters (the enclosing function's formal
        parameters)
      - `const` bindings from the enclosing scope
      - `let` bindings from the enclosing scope, resolved to
        their SSA-versioned name at the point of the `spawn`
        call (the spawned body sees the value at spawn time,
        not subsequent reassignments)

      These references compile to `Ref` nodes in the spawned
      body's IR, resolved against the same execution
      environment that the parent uses. For example, `spec` in
      the overview example is a workflow parameter — it
      compiles to `Ref("spec")` inside the spawned body, and
      the kernel resolves it from the inherited environment at
      execution time.

      The following are NOT permitted as lexical capture:

      - References to spawn-handle variables from the
        enclosing scope (governed by SP11(B), not lexical
        capture)
      - References to names not in scope at the `spawn(...)` call
        site

      **B. Parent handle bindings (NOT inherited).** Handle
      variables and facade objects obtained via `useAgent(...)`
      in the parent scope are NOT visible inside the spawned
      body.

      - *Compiled path:* parent handle bindings are compile-time
        bindings tracked in the parent's scope context. They are
        erased from IR and are not visible in the child.
      - *Runtime facade path:* parent facades are scope-local
        objects. They do not propagate into child scopes.

      In both cases, the spawned body must make its own
      `useAgent(...)` calls to obtain handles or facades.

      **C. Inherited contract availability.** If the parent
      scope has a transport binding for a contract (established
      via `useTransport`), the spawned body MAY call
      `useAgent(Contract)` for that contract without its own
      `useTransport` declaration. The compiler validates
      `useAgent` inside a spawned body against the inherited
      contract set from the enclosing scope.

      In short: outer values are captured normally (A), parent
      handles must be re-acquired via `useAgent` (B), and
      contract availability for `useAgent` validation is
      inherited from the parent scope (C).

> **Note:** Category B is the spawn-specific restriction.
> Categories A and C work the same way inside spawned bodies
> as they do inside arrow function bodies passed to `all(...)`
> or `race(...)` — outer lexical values compile to `Ref` nodes,
> and transport bindings are inherited via scope state.

### 3.6 Middleware and Binding Inheritance

SP12. A spawned child MUST inherit the active transport
      bindings of the enclosing scope at the time of spawn.
      Operationally, this means the child's effect dispatches
      pass through the parent scope's transport routing: an
      effect targeting an agent bound in the parent scope is
      routed to that agent's transport session without the
      child needing its own `useTransport` declaration. This
      inherited availability also satisfies the `useAgent`
      contract requirement (SP11(C)) — the child may obtain
      its own handle for any contract bound in the parent
      scope.

SP13. A spawned child MUST inherit the active enforcement
      wrappers of the enclosing scope at the time of spawn.
      Parent middleware is non-bypassable within the child,
      following the enforcement wrapper model (scoped effects
      specification §7.5).

SP14. If the spawned body contains a `scoped(...)` block, that
      block MAY extend or shadow inherited bindings according
      to the existing blocking-scope rules. The inner scope's
      middleware extends (does not replace) the inherited
      middleware chain.

SP15. Inheritance is a Tisyn semantic requirement. A conforming
      runtime MUST ensure that a spawned child can dispatch to
      parent-bound agents and is subject to parent enforcement
      wrappers, regardless of the concurrency substrate used.

> **Non-normative.** The current implementation achieves SP12–
> SP15 via Effection's context-api, which propagates context
> values to child scopes automatically. This is an
> implementation mechanism, not the normative definition.

---

## 4. Distinguished IR Forms

### 4.1 Spawn Node

`spawn` is a distinguished IR form, following the same pattern
as `scope`, `all`, and `race`. It is a compound-external
operation encoded via the existing `Eval + Quote` machinery.

````
Eval("spawn", Quote({
  body: Expr
}))
````

The `data` field is a `Quote` node containing a plain object
with one field: `body`.

`spawn` does not carry handler or binding metadata of its own.
The spawned child inherits the parent scope's active bindings
and enforcement wrappers at spawn time (§3.6). A nested
`scoped(...)` block within the spawned body is needed only if
the child wants to add new transport bindings, install new
middleware, or shadow inherited configuration. It is NOT needed
merely to call `useAgent(...)` for a parent-bound contract.

### 4.2 Join Node

`join` is a distinguished IR form for waiting on a spawned
child. It is a compound-external operation.

````
Eval("join", Ref("task"))
````

The `data` field is a `Ref` to the task handle variable. The
kernel passes this through via `unquote` without resolving,
and the runtime evaluates the reference against the
environment to obtain the task handle value.

### 4.3 Task Handle Value

The task handle is a capability value as defined in §2. Its
runtime representation is:

````
{ __tisyn_task: childCoroutineId }
````

This value is produced by the runtime when a spawn descriptor
is processed (§6.1 R2). It is bound in the parent kernel's
environment via `Let` so the parent can later reference it via
`Ref` and yield it to the runtime via `Eval("join", ...)`.

The restrictions on capability values (§2) are enforced by the
compiler at the authored level (SP4) and by the runtime for
hand-constructed IR.

On replay, the runtime creates a fresh handle with the same
`childCoroutineId` (deterministic from `childSpawnCount`). The
fresh handle is semantically equivalent — it refers to the
same logical child, which replays from its own journal entries.

### 4.4 Validation

V1. The spawn node's `body` MUST be a valid IR expression.

V2. The join node's `data` MUST be a valid `Ref` node.
    Whether the referenced name resolves to a task handle is
    a runtime obligation, not an IR validation check.

---

## 5. Kernel Evaluation

### 5.1 Classification

`"spawn"` and `"join"` MUST be added to the compound-external
ID set alongside `"scope"`, `"all"`, and `"race"`.

`isCompoundExternal("spawn")` MUST return `true`.
`isCompoundExternal("join")` MUST return `true`.
`classify("spawn")` MUST return `EXTERNAL`.
`classify("join")` MUST return `EXTERNAL`.

### 5.2 Spawn Evaluation

When the kernel encounters `Eval("spawn", D, E)`:

````
eval_spawn(D, E):
  inner = unquote(D, E)
  descriptor = {
    id: "spawn",
    data: {
      __tisyn_inner: inner,
      __tisyn_env: E
    }
  }
  result = SUSPEND(descriptor)
  return result
````

The kernel yields the descriptor and resumes with the task
handle value provided by the runtime.

### 5.3 Join Evaluation

When the kernel encounters `Eval("join", D, E)`:

````
eval_join(D, E):
  inner = unquote(D, E)
  descriptor = {
    id: "join",
    data: {
      __tisyn_inner: inner,
      __tisyn_env: E
    }
  }
  result = SUSPEND(descriptor)
  return result
````

The kernel yields the descriptor and resumes with the child's
return value provided by the runtime.

### 5.4 Kernel Non-Responsibility

The kernel MUST NOT create child tasks, schedule concurrent
execution, resolve task handles, wait for children, write
journal events, or manage lifecycle for spawned children. The
kernel's sole responsibility is to extract, yield, and resume.

---

## 6. Runtime Lifecycle

### 6.1 Spawn Entry

When the runtime receives a spawn descriptor from the kernel
in the `driveKernel` dispatch loop, it MUST:

R1. **Allocate child coroutineId.** The runtime MUST allocate
    a coroutineId using the deterministic child ID scheme:
    `child_id(parent_id, childSpawnCount)`. The
    `childSpawnCount` is the parent's unified counter across
    all compound-external children (`scope`, `all`, `race`,
    `spawn`), incremented at spawn time.

R2. **Create task handle.** The runtime MUST create a task
    handle value: `{ __tisyn_task: childCoroutineId }`.

R3. **Spawn child as Effection background task.** The runtime
    MUST spawn a new Effection task (via Effection's `spawn`)
    within the parent's current structured scope. The child
    task drives a fresh kernel generator for the spawn
    descriptor's body expression with the inherited execution
    environment and the allocated child coroutineId.

R4. **Resume parent with task handle.** The runtime MUST
    resume the parent kernel with the task handle value
    without waiting for the child to complete. The parent's
    foreground execution continues.

### 6.2 Join

When the runtime receives a join descriptor from the kernel:

R5. **Resolve task handle.** The runtime MUST evaluate the
    join descriptor's inner data against the environment to
    obtain the task handle value. The runtime MUST extract the
    `__tisyn_task` field to determine the child coroutineId.

R6. **Wait for child completion.** The runtime MUST suspend
    the parent's kernel drive loop until the identified child
    reaches `closed` state. Specifically, the runtime waits
    for the child's terminal `CloseEvent` (ok, err, or
    cancelled). This is a structural wait — it does NOT
    advance the parent's yieldIndex and does NOT produce a
    `YieldEvent`.

R7. **Resume parent with child result.** When the child's
    `CloseEvent` is observed:
    - `Close(ok, value)`: the runtime resumes the parent
      kernel with `value`.
    - `Close(err, error)` or `Close(cancelled)`: the parent
      scope has already been torn down by the failure/
      cancellation propagation rule (§6.4). The join point
      is never reached in normal execution. If the runtime
      encounters a join for a failed or cancelled child, it
      MUST fail with an internal runtime invariant error.
      This error is NOT an authored-language exception and
      MUST NOT be catchable by `try/catch` in the workflow —
      it indicates a bug in the runtime, not a recoverable
      condition.

R8. **Double join.** If the parent joins a task that has
    already been joined, the runtime MUST fail with a
    descriptive error.

### 6.3 Concurrent Execution

R9. After spawning, the parent and child execute concurrently
    within the same Effection scope. Both may dispatch effects
    and produce journal events simultaneously.

R10. The parent's `yieldIndex` continues advancing while the
     child executes. This is the key difference from `all` and
     `race`, where the parent is blocked and its yieldIndex
     does not advance.

R11. The child has its own independent `yieldIndex`, starting
     at 0, following the standard per-coroutineId counter
     model.

### 6.4 Child Failure Propagation

The failure propagation model is a single schedule-independent
rule:

> **If a spawned child fails, the error propagates to the
> parent's scope unconditionally.** The scope tears down:
> remaining children and the parent's foreground are
> cancelled. This does not depend on whether the parent has
> bound a task handle, whether a join exists in the code, or
> whether the parent has reached a join point.

R12. **Child failure tears down scope.** If a spawned child
     fails with an uncaught error, the error MUST propagate
     to the parent's Effection scope immediately. This is
     Effection's standard structured concurrency behavior:
     an unhandled error in a background task fails the
     enclosing scope.

R13. **No per-child error catching at join.** In this
     specification version, the parent cannot catch a child's
     error at the `yield* handle` join point. If the child
     fails, the scope tears down before the parent can reach
     (or continue past) the join.

R13a. **Catch boundary.** A child failure is catchable ONLY
      outside the `scoped(...)` call that contains the
      `spawn(...)`. The valid MVP catch pattern is:

      `try { yield* scoped(function* () { ... }) } catch (e) { ... }`

      The error E from the failing child surfaces as the
      thrown exception of the `yield* scoped(...)` expression.

R13b. **Not catchable inside the same scope body.** A
      `try/catch` around the `yield* handle` join point
      inside the same scope body does NOT catch the child's
      error. A `try/catch` around the `spawn(...)` call or
      around other work inside the same scope body also does
      NOT catch the child's error. Child failure propagates
      via Effection's scope failure mechanism, which tears
      down the entire scope — it does not throw as an
      ordinary local exception within the scope body's
      control flow.

R13c. **Summary.** Given a child that fails with error E:
      - `try { yield* scoped(...) } catch (e)` — **catches E**
      - `try { yield* task } catch (e)` inside the scope — **does not catch E**
      - `try { yield* spawn(...); ... } catch (e)` inside the scope — **does not catch E**

R14. **Determinism.** This rule is schedule-independent.
     Regardless of whether the parent or child executes first
     after spawn, the outcome of a child failure is the same:
     scope teardown. The program does not branch based on
     scheduling order.

R15. The failing child's `Close(err)` event MUST be written
     before the parent scope begins teardown in response to
     the propagated error.

### 6.5 Parent Foreground Completion

R16. When the parent's foreground computation completes (the
     parent kernel returns a value), the parent's scope does
     NOT exit immediately. The scope remains open until all
     spawned children have completed.

R17. While the scope waits for spawned children, no new
     parent journal events are produced (the parent kernel has
     already returned). Spawned children continue producing
     events under their own coroutineIds.

R18. Once all spawned children are closed, scope teardown
     proceeds: transport shutdown, middleware removal, and
     `CloseEvent` for the parent.

### 6.6 Parent Scope Exit and Child Cancellation

R19. If the parent scope is cancelled (by its own parent, or
     because the parent is inside a `race` that another child
     won), all spawned children within that scope are cancelled
     via Effection's structured cancellation propagation.

R20. Each cancelled child writes `Close(cancelled)` under its
     own coroutineId.

R21. Spawned child cancellation and cleanup MUST complete
     before the parent scope's own `CloseEvent` is written.

---

## 7. Journal Ordering

### 7.1 Per-CoroutineId Independence

J1. Parent and spawned child events are independent in the
    global journal. Their relative global ordering is NOT
    deterministic — it depends on Effection's scheduling.

J2. Within each coroutineId, events MUST appear in
    `yieldIndex` order. This is the existing per-coroutineId
    monotonicity invariant (compound concurrency spec §9.5).

### 7.2 Ordering Invariants

J3. **Child Close before parent Close.** A spawned child's
    `CloseEvent` MUST appear in the journal before the
    parent's `CloseEvent`. This is the existing O5 invariant
    (kernel spec §9.5) applied recursively.

J3a. **Child failure ordering.** If a spawned child fails,
     the child's `Close(err)` MUST appear in the journal
     before any `Close(cancelled)` events for sibling
     children or the parent that are cancelled as a
     consequence of the failure propagation.

J4. **Parent foreground completion does not produce Close.**
    The parent's `CloseEvent` is NOT written when the parent
    kernel returns. It is written after all spawned children
    are closed and scope teardown completes.

J5. **No ordering between parent Yields and child Yields.**
    A parent `YieldEvent` at yieldIndex K and a child
    `YieldEvent` at yieldIndex M have no guaranteed relative
    order in the global journal. Replay does not depend on
    their relative position.

### 7.3 Spawn and Join Are Not Journaled

J6. `spawn` is a compound-external operation. Like `scope`,
    `all`, and `race`, it does NOT advance the parent's
    yieldIndex and does NOT produce a `YieldEvent`.

J7. `join` is a compound-external operation. It does NOT
    advance the parent's yieldIndex and does NOT produce a
    `YieldEvent`. The join is a structural wait — the result
    comes from the child's `CloseEvent`, not from a new
    journal entry.

---

## 8. Replay and Durability

### 8.1 No New Event Types

This specification does NOT introduce new durable event types.
The durable stream remains `YieldEvent | CloseEvent` only.

Spawn creation, task handle provision, and join waiting are
NOT journaled. They are reconstructed from the IR on replay.

### 8.2 Task Handle Ephemerality

The task handle value is ephemeral. It is NOT stored in the
journal. On replay, the runtime re-creates the task handle
when it re-processes the spawn descriptor. The parent kernel
receives a fresh handle with the same child coroutineId
(deterministic from `childSpawnCount`). When the parent later
joins, the runtime waits for the child's replay to complete.

### 8.3 Per-CoroutineId Replay Cursors

The existing per-coroutineId replay cursor model (compound
concurrency spec §10.1) is sufficient for spawned children.
Each coroutine — parent and each spawned child — has its own
independent replay cursor.

### 8.4 Replay Reconstruction

On replay, the kernel re-evaluates the IR. When it encounters
the spawn node, it yields the same descriptor. The runtime:

RR1. Allocates the same child coroutineId (deterministic
     allocation using the parent's unified `childSpawnCount`).

RR2. Creates a fresh task handle with that coroutineId.

RR3. Spawns the child as an Effection background task.

RR4. Resumes the parent kernel with the task handle.

RR5. The child begins replay from its own stored journal
     events. If it has a complete journal (including `Close`),
     it replays to completion without live dispatch. If
     partial, it replays available entries and transitions to
     live. If empty, it begins live execution.

RR6. The parent continues replay from its own cursor,
     concurrent with the child's replay.

When the parent reaches a join point during replay:

RR7. The runtime checks whether the child's terminal state
     is already known by calling
     `replayIndex.getClose(childCoroutineId)`. If a
     `CloseEvent` with status `ok` exists, the runtime
     extracts the value and resumes the parent kernel. If a
     `CloseEvent` with status `err` or `cancelled` exists,
     the scope teardown replays and the parent never reaches
     the join — the runtime does not need to resume the
     parent kernel at the join point.

RR8. If no `CloseEvent` exists for the child's coroutineId
     in the replay index (partial or absent child journal),
     the runtime MUST wait for the child's replay or live
     execution to reach terminal state before resuming the
     parent. The parent's replay cursor MUST NOT advance past
     the join until the child's terminal state is determined.

RR9. Duplicate join detection applies identically during
     replay and live execution: if the parent replays a
     second join for the same child coroutineId, the runtime
     MUST fail with a descriptive error.

### 8.5 Determinism

- Same IR → same spawn nodes in the same positions
- Same `childSpawnCount` progression → same child coroutineIds
- Same per-coroutineId journal entries → same replay results
  for each coroutine independently
- Global interleaving order may differ on replay. This is
  correct — no semantic decision depends on global order.
- Child failure outcome is schedule-independent: a failing
  child always tears down the parent scope, regardless of
  whether the parent has reached a join point.
- Join results are deterministic: the child's return value is
  determined by its journal entries and body IR.

### 8.6 Crash Recovery

A crash may occur:

- **Before spawn:** The parent replays to the spawn point and
  re-spawns the child. Fresh task handle.
- **After spawn, before join, child in progress:** The parent
  replays past the spawn (receives a fresh handle). The child
  replays its stored events. When the parent reaches join, it
  waits for the child.
- **After join, child completed:** The child's `Close` is in
  the journal. The child replays to completion. The parent
  replays past the join with the same result.
- **After all children completed:** Normal replay.

---

## 9. Compiler Obligations

### 9.1 `spawn(...)` Recognition

The compiler MUST add a new dispatch case in its `yield*`
processing path. When the `yield*` target is a call to `spawn`
with a generator function argument, the compiler MUST:

C1. Validate the argument is a generator function expression.

C2. Validate placement (SP7, SP8).

C3. Compile the inner generator's body via the existing
    statement compilation pipeline.

C3a. If the `spawn(...)` appears inside a `scoped(...)` block
     that has established contracts via `useTransport(...)`,
     the compiler MUST propagate those contracts as available
     for `useAgent(...)` validation inside the spawned body.
     The spawned body's compilation context includes the
     parent scope's contract map, even though the spawned
     body does not have its own setup prefix.

C3b. The compiler MUST carry the enclosing scope stack into
     the spawned body's compilation context. Enclosing bindings
     (workflow parameters, `const` bindings, SSA-versioned
     `let` bindings) are available inside the spawned body via
     the compiler's standard `resolveRef` mechanism. References
     to these bindings compile to `Ref` nodes that resolve
     against the inherited execution environment at runtime.
     Spawn-handle bindings are excluded per SP11(B) and C8.

C4. Emit a spawn node: `Eval("spawn", Quote({ body }))`.

C5. If the `spawn(...)` appears as a `const` initializer,
    record a spawn-handle binding in the compiler context
    associating the variable name with the spawn operation.

### 9.2 Task Handle Join

When the compiler encounters `yield* identifier` where
`identifier` is a recorded spawn-handle binding, it MUST:

C6. Emit a join node: `Eval("join", Ref(identifier))`.

C7. Validate that the join appears in a permitted position
    (SP5).

### 9.3 Task Handle Restriction Enforcement

C8. The compiler MUST reject usage of a spawn-handle variable
    in any position other than `yield* handle` (SP4).

C9. The compiler SHOULD reject a second `yield* handle` for
    the same spawn-handle binding if statically detectable.

### 9.4 Acceptance and Rejection

The compiler MUST reject authored source that violates any
constraint defined in §3 (SP1–SP15) with a diagnostic that
identifies the violated constraint.

The compiler MUST accept authored source that satisfies all
constraints defined in §3 and produce IR conforming to §4.

> **Non-normative.** Specific error codes, diagnostic message
> formats, and diagnostic severity levels are a compiler
> quality-of-implementation concern.

---

## 10. Teardown and Error Ordering

### 10.1 Success — All Children Complete

When the parent foreground completes with value V and all
spawned children complete successfully:

T1. Each child writes `Close(ok, childValue)` under its own
    coroutineId.

T2. After all children are closed, the parent's scope teardown
    runs.

T3. The parent writes `Close(ok, V)` under its own
    coroutineId.

### 10.2 Child Failure

When a spawned child fails with error E, regardless of join
state:

T4. The failing child writes `Close(err, E)` under its own
    coroutineId.

T5. The error propagates to the parent's Effection scope
    per §6.4 R12.

T6. Remaining spawned children and the parent's foreground
    (if still running) are cancelled.

T7. Each cancelled entity writes `Close(cancelled)` under
    its respective coroutineId.

T8. Parent scope teardown runs.

T9. The parent writes `Close(err, E)` under its own
    coroutineId, reflecting the child's error.

> **Catchability.** The error E from a failing child is
> catchable ONLY outside the `scoped(...)` call:
> `try { yield* scoped(...) } catch (e) { ... }`. It is NOT
> catchable by `try/catch` inside the same scope body, whether
> around the join point or elsewhere. Per-child error catching
> at `yield* handle` is deferred (§11.5).

### 10.3 Parent Foreground Failure

When the parent's foreground throws error E while children are
running:

T10. All spawned children are cancelled.

T11. Each cancelled child writes `Close(cancelled)`.

T12. Parent scope teardown runs.

T13. The parent writes `Close(err, E)`.

### 10.4 Cancellation

When the parent scope is cancelled externally:

T14. All spawned children are cancelled.

T15. Each cancelled child writes `Close(cancelled)`.

T16. The parent writes `Close(cancelled)`.

### 10.5 Ordering Invariants

T17. **Children close before parent.** All spawned children's
     `CloseEvent`s MUST appear in the journal before the
     parent's `CloseEvent`.

T18. **Scope teardown after children.** Parent scope teardown
     MUST NOT begin until all spawned children are in `closed`
     state.

T19. **Teardown before parent Close.** Parent scope teardown
     MUST complete before the parent's `CloseEvent` is
     written.

---

## 11. Deferred Extensions

The following are explicitly out of scope for this
specification version.

### 11.1 Detached / Unstructured Background Tasks

This specification requires spawned children to be bounded by
their parent scope's lifetime. Detached tasks that outlive
their parent scope are not supported. They would violate
Effection's structured concurrency model.

### 11.2 Spawn with Setup / Bindings / Handler

This specification does not allow `spawn(...)` to carry handler
or binding metadata directly. A spawned child that needs
middleware or transport bindings uses `scoped(...)` inside its
body. A future version MAY combine `spawn` + `scoped` into a
single operation.

### 11.3 Resource Value Provision

`resource(...)` — a scope-creating operation that provides a
value to the parent — is not covered by this specification. It
depends on non-blocking scope creation (established here) plus
a `provide` mechanism. See the scope-family research for
sequencing.

### 11.4 Stream / Collection Consumption

Patterns like iterating over streams of capabilities with
nested `spawn` depend on iteration primitives (`each`, `for`
over streams) that are not yet specified.

### 11.5 Per-Child Error Catching at Join

This specification propagates child errors to the parent scope
unconditionally. The error is catchable at the scope boundary
(`try { yield* scoped(...) } catch`), but NOT at the join
point inside the scope body.

A future version MAY allow the parent to catch a specific
child's error at the `yield* handle` join point via
`try { const result = yield* task; } catch (e) { ... }`,
turning the join into a per-task error-delivery mechanism.
This would require either buffering the error until the
parent reaches the join, or schedule-aware failure routing
that distinguishes "child failed while parent is at join"
from "child failed while parent is elsewhere." Both
approaches introduce schedule-sensitivity and are deferred.

### 11.6 Spawn Inside Setup Prefix

SP7 restricts `spawn(...)` to body position. A future version
MAY allow spawn in setup position for background initialization
tasks.

### 11.7 Task Handle Passing Across Scope Boundaries

SP4 restricts task handles to the lexical scope that spawned
them. A future version MAY relax this to allow passing handles
to other scopes or returning them.

---

## Appendix A: Design Notes

> **Non-normative.** These notes explain the key design
> choices.

### A.1 Journal Interleaving

The existing per-coroutineId replay cursor model handles
concurrent parent-child execution without modification. Parent
events at `(parentId, yieldIndex)` and child events at
`(childId, yieldIndex)` are fully independent sequences.

The `ReplayIndex` is a `Map<CoroutineId, Array<YieldEntry>>`
with per-coroutineId cursors. It does not assume or enforce
cross-coroutineId ordering. No new replay machinery is needed.

### A.2 Task Handle as Capability Value

The task handle is an opaque capability value in the kernel's
environment, similar in status to how transport factory values
are opaque objects resolved from the environment. The kernel
can bind it (`Let`), reference it (`Ref`), and yield it back
to the runtime (via `join`). It never appears in the journal.

On replay, the runtime creates a fresh handle with the same
child coroutineId (deterministic from `childSpawnCount`). The
handle is semantically equivalent: it points to the same
logical child, which replays from its own journal entries.

### A.3 Join as Compound-External

`join` is classified as compound-external rather than standard
external. This means:

- The kernel uses `unquote`, not `resolve`.
- The runtime receives the raw `Ref` and resolves it against
  the environment itself.
- No `YieldEvent` is produced.
- No yieldIndex advance.

This is correct because join is a structural wait for a child
that already has its own journal. The child's effects are
journaled under the child's coroutineId. The join itself is
just the parent waiting for those effects to complete — it
adds no new information to the journal.

### A.4 Spawn Index Allocation

The runtime's `driveKernel` already maintains a
`childSpawnCount` that increments for each compound-external
child. `spawn` uses the same counter. The index is assigned at
spawn time (when the parent kernel yields the descriptor),
which is deterministic because the parent's kernel execution
is sequential.

### A.5 Failure Propagation Model

One path: child failure propagates to the parent scope
unconditionally. The scope tears down. This is Effection's
standard behavior for `spawn`.

The critical property: this rule is schedule-independent.
Whether the parent has reached a join point, is suspended on
an agent call, or is computing locally — the outcome is the
same. The program does not branch based on which coroutine
the scheduler ran first.

The earlier design considered a two-path model where joined
children delivered errors at the join point and unjoined
children propagated immediately. This was removed because it
created a scheduling race: the program outcome depended on
whether the parent reached `yield* handle` before the child
failed. That race violated the spec's determinism claims and
would produce non-reproducible behavior under replay.

Per-child error catching at join is deferred to a future
version (§11.5) that can introduce the necessary scheduling
or buffering semantics.

### A.6 Catchability Example

The MVP catch pattern puts `try/catch` outside the scope:

```typescript
// VALID: catch at the scope boundary
try {
  yield* scoped(function* () {
    const task = yield* spawn(function* () {
      throw new Error("boom");
    });
    yield* task;
  });
} catch (e) {
  // e is Error("boom") — this is the valid catch site
}
```

The following do NOT catch the child's error in the MVP:

```typescript
yield* scoped(function* () {
  const task = yield* spawn(function* () {
    throw new Error("boom");
  });

  // INVALID: try/catch around the join point
  try {
    yield* task;
  } catch (e) {
    // NOT reached — scope has already torn down
  }

  // INVALID: try/catch around other work
  try {
    // ... other work ...
  } catch (e) {
    // NOT reached — scope has already torn down
  }
});
```

The reason: child failure propagates via Effection's scope
failure mechanism. The scope itself fails, cancelling all
foreground and background work within it. The error surfaces
as the thrown exception of the `yield* scoped(...)` expression
in the parent's control flow — outside the scope, not inside.

---

## Appendix B: Compilation Example

> **Non-normative.**

### Source

````typescript
export function* orchestrate(spec: Spec): Workflow<Patch> {
  return yield* scoped(function* () {
    yield* useTransport(Coder, coderTransport);
    yield* useTransport(Reviewer, reviewerTransport);

    const reviewTask = yield* spawn(function* () {
      const reviewer = yield* useAgent(Reviewer);
      return yield* reviewer.preloadContext(spec);
    });

    const coder = yield* useAgent(Coder);
    const patch = yield* coder.implement(spec);

    const reviewReady = yield* reviewTask;
    return patch;
  });
}
````

### IR Structure (simplified)

````
Eval("scope", Quote({
  handler: null,
  bindings: {
    "coder": Ref("coderTransport"),
    "reviewer": Ref("reviewerTransport"),
  },
  body: Let("reviewTask",
    Eval("spawn", Quote({
      body: Eval("reviewer.preloadContext",
        Construct({ spec: Ref("spec") }))
    })),
    Let("patch",
      Eval("coder.implement",
        Construct({ spec: Ref("spec") })),
      Let("reviewReady",
        Eval("join", Ref("reviewTask")),
        Ref("patch"))))
}))
````

> **Note:** `useAgent` calls are erased. The spawned body's
> `reviewer.preloadContext` call uses the inherited `reviewer`
> transport binding from the parent scope — per SP11(C), the
> spawned body inherits contract availability and may call
> `useAgent(Reviewer)` without its own `useTransport`. The
> outer `spec` parameter is accessible inside the spawned body
> via ordinary lexical capture (SP11(A)) — it compiles to
> `Ref("spec")` and resolves from the inherited environment.
> `reviewTask` is bound via `Let` to the spawn result (task
> handle), then joined via `Eval("join", Ref("reviewTask"))`.

---

## Appendix C: Deferred Items Summary

| Item | Reason | Future location |
|---|---|---|
| Detached background tasks | Violates structured concurrency | Out of scope |
| Spawn with setup/bindings | Ordering questions | Future amendment |
| `resource(...)` value provision | Needs `provide` mechanism | Future spec |
| Stream/collection consumption | Needs iteration primitives | Future spec |
| Per-child error catching at join | Schedule-sensitive; needs buffering design | Future amendment |
| Spawn inside setup prefix | Ordering questions | Future amendment |
| Task handle passing across scopes | Relaxation of SP4 | Future amendment |
