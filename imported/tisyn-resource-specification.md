# Tisyn Resource Specification

**Version:** 0.1.0
**Implements:** Tisyn System Specification 1.0.0
**Amends:** Tisyn Kernel Specification 1.0.0, Tisyn Compiler
Specification 1.2.0
**Depends on:** Tisyn Blocking Scope Specification 0.1.0,
Tisyn Spawn Specification 0.1.0
**Status:** Draft

---

## 1. Overview

This specification defines resource scope creation for authored
Tisyn workflows via `resource(...)`. A resource creates a child
scope that executes an initialization phase, provides a value
to the parent, and remains alive until the parent scope exits.
When the parent scope exits — whether by normal completion,
error, or cancellation — the resource child scope is torn down
and its cleanup code runs.

`resource(...)` is the third scope-creating operation, after
blocking `scoped(...)` and non-blocking `spawn(...)`. It
reuses the scope substrate established by the blocking-scope
specification: the distinguished semantic form, child
coroutineId allocation, runtime-owned lifecycle, and replay
reconstruction from IR.

The resource primitive occupies a semantic niche distinct from
both `scoped` and `spawn`: the parent blocks during
initialization (like `scoped`), receives a value, then
continues while the child stays alive (like `spawn`). This
combination — a non-blocking child scope with an
initialization barrier — cannot be expressed through existing
primitives without introducing synchronization mechanisms
outside the current Tisyn model.

The target authored surface is:

````typescript
const session = yield* resource(function* () {
  const s = yield* dbAgent.createSession(config);
  try {
    yield* provide(s);
  } finally {
    yield* dbAgent.closeSession(s);
  }
});
const result = yield* dbAgent.query(session, "SELECT 1");
````

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- authored-language rules for `resource(...)` and `provide(...)`
- the `resource` and `provide` distinguished IR forms
- kernel evaluation rules for `resource` and `provide`
- runtime resource lifecycle: child creation, initialization,
  value provision, background lifetime, teardown, failure
  propagation, and cancellation
- journal ordering for resource child execution
- replay semantics for resource initialization and teardown

This specification defines only the minimal resource form with
a single `provide` call and optional `try/finally` cleanup.
Normative rules for resource composition with `all`/`race`,
resource-to-resource nesting edge cases, resource with handler
or binding metadata, and transport binding compilation to
resource internals are deferred to future specifications.

### 1.3 Relationship to Other Specifications

This specification amends the kernel specification by adding
`"resource"` and `"provide"` to the compound-external ID set.
It amends the compiler specification by adding `resource` and
`provide` authored forms and compilation rules.

It builds on the blocking-scope specification for scope
metadata, child coroutineId allocation, and runtime-owned
lifecycle patterns. It builds on the spawn specification for
non-blocking child creation, background lifetime semantics,
and child failure propagation to the parent scope.

### 1.4 Key Design Decisions

This draft makes the following concrete choices:

- `yield* resource(fn)` blocks the parent until the child
  provides a value. The parent resumes with the provided
  value. The child remains alive.
- `yield* provide(value)` is the child-internal mechanism for
  signaling the provided value. It suspends the child at the
  provide point. Cleanup code in a surrounding `finally` block
  runs during teardown.
- Resource bodies carry no handler or binding metadata. A
  resource body that needs middleware or transport bindings
  MUST use a nested `scoped(...)` block.
- The provided value is any value the initialization phase can
  produce. It is never journaled — it is recomputed by
  replaying the child's initialization phase on recovery.

---

## 2. Terminology

**Resource.** A scope-creating operation that initializes a
value, provides it to the parent scope, and keeps the child
scope alive until the parent exits.

**Provided value.** The value yielded by the resource body to
the parent at the provide point. This is the value the parent
receives from `yield* resource(...)`. It is not journaled.

**Provide point.** The point in a resource body's execution at
which `yield* provide(value)` is reached. The child suspends
here. The parent resumes with the provided value. The child
remains suspended until teardown.

**Initialization phase.** The portion of the resource body
that executes before the provide point. May contain agent
calls and other operations. Their effects are journaled under
the resource child's coroutineId.

**Teardown.** The cleanup of the resource child scope,
triggered when the parent scope exits. During normal teardown
(non-cancellation), the resource body resumes from the provide
point, `finally` blocks execute, cleanup effects are journaled,
and the child's `CloseEvent` is written.

**Child scope.** The scope created by the runtime for the
resource body. Its lifetime is bounded by the parent scope.

**Parent scope.** The scope that contains the `resource(...)`
call. The resource child is a direct child of this scope.

---

## 3. Authored-Language Constraints

### 3.1 Resource Form

RS1. `resource(...)` MUST accept a single argument: a
     generator function expression.

RS2. `resource(...)` MUST appear as the argument to `yield*`.

RS3. The resource body MUST NOT carry handler or binding
     metadata directly. A resource body that needs middleware
     or transport bindings MUST use a nested `scoped(...)`
     block within the resource body.

RS4. A resource body MUST contain exactly one `provide` call
     satisfying constraints P1–P7 below.

RS5. `resource(...)` MUST appear in body position only (not in
     a scope setup prefix). This follows the same restriction
     as `spawn(...)` (spawn specification SP7).

RS6. A resource child MUST inherit the active transport
     bindings and enforcement wrappers of the enclosing scope
     at the time of resource creation. This follows the same
     inheritance model as `spawn(...)` (spawn specification
     SP12–SP15).

### 3.2 Provide Placement

P1. `provide(expr)` MUST appear as the argument to `yield*`:
    `yield* provide(expr)`.

P2. `provide` is valid ONLY inside a `resource(function* () {
    ... })` body. The compiler MUST reject `provide` in any
    other context.

P3. `provide` MUST appear exactly once on every non-throwing
    control-flow path through the resource body.

P4. `provide` MUST appear at exactly one of these positions:

    (a) The final expression in the resource body, or

    (b) The body expression of a `try` block at the resource
        body's top level.

P5. `provide` MUST NOT appear inside `if`, `while`, `scoped`,
    `spawn`, `all`, `race`, or any nested generator function
    body.

P6. No expression in the resource body may follow `provide` at
    the same nesting level. In the `try/finally` form (P4b),
    only the `finally` block follows.

P7. `provide` evaluates `expr`, yields the resulting value to
    the parent scope, and suspends the resource body. `provide`
    does not produce a meaningful return value; its result in
    the resource body is `null`.

### 3.3 Provide and `try/finally`

The primary pattern for resource cleanup uses `try/finally`:

````typescript
yield* resource(function* () {
  const handle = yield* agent.acquire(args);
  try {
    yield* provide(handle);
  } finally {
    yield* agent.release(handle);
  }
});
````

The `finally` block runs during teardown when the parent scope
exits. Effects dispatched in the `finally` block are journaled
under the resource child's coroutineId, continuing the same
yieldIndex sequence as the initialization phase.

### 3.4 Accepted Examples

````typescript
// Minimal: provide with no cleanup
const id = yield* resource(function* () {
  const s = yield* dbAgent.createSession();
  yield* provide(s);
});

// With cleanup via try/finally
const conn = yield* resource(function* () {
  const c = yield* dbAgent.connect(config);
  try {
    yield* provide(c);
  } finally {
    yield* dbAgent.disconnect(c);
  }
});

// With scoped block for transport bindings
const result = yield* resource(function* () {
  const value = yield* scoped(function* () {
    yield* useTransport(Service, serviceTransport);
    const svc = yield* useAgent(Service);
    return yield* svc.initialize();
  });
  try {
    yield* provide(value);
  } finally {
    yield* cleanupAgent.release(value);
  }
});
````

### 3.5 Rejected Examples

````typescript
// REJECTED: provide inside if (P5)
yield* resource(function* () {
  if (cond) { yield* provide(a); }
  else { yield* provide(b); }
});

// REJECTED: code after provide at same level (P6)
yield* resource(function* () {
  yield* provide(val);
  yield* agent.doMore();
});

// REJECTED: multiple provides (P3)
yield* resource(function* () {
  yield* provide(a);
  yield* provide(b);
});

// REJECTED: provide outside resource body (P2)
function* helper() { yield* provide(val); }
````

---

## 4. Distinguished IR Forms

### 4.1 Resource Node

`resource` is a distinguished scope-creating IR form,
following the same pattern as `scope` and `spawn`. It is
encoded via the existing `Eval + Quote` machinery.

````
Eval("resource", Quote({
  body: Expr
}))
````

The `data` field is a `Quote` node containing a plain object
with one field: `body`.

`resource` does not carry handler or binding metadata of its
own. The resource child inherits the parent scope's active
bindings and enforcement wrappers at resource creation time
(RS6). A nested `scoped(...)` block within the resource body
is needed only if the child wants to add new transport
bindings, install new middleware, or shadow inherited
configuration.

### 4.2 Provide Node

`provide` is a distinguished IR form for signaling the
provided value from within a resource body. It is a
child-internal coordination form, not a scope-creating form.

````
Eval("provide", valueExpr)
````

The `data` field is a value expression. It is NOT wrapped
in `Quote`. This follows the same pattern as `join` (spawn
specification §4.2), which also uses non-Quote data in a
compound-external-routed operation.

When the kernel processes this node, `unquote` falls through
to `eval` on the non-Quote data (kernel specification §4.1),
evaluating the value expression in the current environment.
The resulting Val is the provided value.

### 4.3 Validation

V1. The resource node's `body` MUST be a valid IR expression.

V2. The resource node's `body` MUST contain exactly one
    `Eval("provide", ...)` node reachable on every
    non-throwing evaluation path. This is a compiler
    obligation (§9); the runtime SHOULD detect and report
    missing `provide` as a defensive check.

V3. The provide node's `data` MUST be a valid IR expression.

---

## 5. Kernel Evaluation

### 5.1 Classification

This specification adds `"resource"` and `"provide"` to the
compound-external ID set.

`isCompoundExternal("resource")` MUST return `true`.
`isCompoundExternal("provide")` MUST return `true`.

`classify("resource")` MUST return `EXTERNAL`.
`classify("provide")` MUST return `EXTERNAL`.

> **Design note.** `resource` and `provide` are added to the
> compound-external set because both require `unquote`
> semantics and runtime-handled suspension. They are not the
> same semantic kind of operation: `resource` is a scope-
> creating orchestration form (like `scope` and `spawn`);
> `provide` is a child-internal coordination form (like
> `join`). They share the compound-external routing path
> because both need the kernel to yield unevaluated or
> selectively evaluated data for the runtime to interpret,
> rather than resolving data for agent dispatch.

### 5.2 Resource Evaluation

When the kernel encounters `Eval("resource", D, E)`:

````
eval_resource(D, E):
  inner = unquote(D, E)
  descriptor = { id: "resource", data: inner }
  result = SUSPEND(descriptor)
  return result
````

`unquote` strips the `Quote`, producing `{ body: Expr }` with
the body expression unevaluated. The kernel suspends. The
runtime receives the descriptor, orchestrates the resource
lifecycle (§6), and resumes the kernel with the provided
value.

This follows the compound-external pattern defined in kernel
specification §4.4.

### 5.3 Provide Evaluation

When the kernel encounters `Eval("provide", D, E)`:

````
eval_provide(D, E):
  inner = unquote(D, E)
  descriptor = { id: "provide", data: inner }
  result = SUSPEND(descriptor)
  return result
````

Because the provide node's data is NOT `Quote`-wrapped,
`unquote` calls `eval(D, E)` (kernel specification §4.1),
fully evaluating the value expression. The descriptor's `data`
field contains the evaluated value (a Val).

The kernel suspends. The child kernel remains suspended at
this point until the runtime either resumes it (during
teardown) or cancels its scope.

### 5.4 Runtime Access to Environment

The runtime requires access to the evaluation environment at
the point of resource suspension in order to create a child
kernel for the resource body. The mechanism by which the
environment is communicated from kernel to runtime is
implementation-defined.

> **Non-normative.** The current implementation attaches the
> environment to the yielded descriptor via an internal
> wrapper struct. This is not a normative descriptor shape;
> conforming implementations MAY use any mechanism that
> provides the runtime with the evaluation environment at the
> correct point. The environment is a kernel-internal
> structure (kernel specification §2, environment invariant
> I3) and MUST NOT be treated as part of the serializable
> effect descriptor contract.

### 5.5 Kernel Non-Responsibility

The kernel MUST NOT:

- Know that `provide` is related to `resource`
- Manage resource lifecycle or teardown
- Distinguish initialization from cleanup
- Allocate child coroutineIds
- Write journal events for resource entry, provide, or exit

The kernel's sole responsibility is to extract, yield, and
resume. This is identical to the kernel non-responsibility
for `scope` (blocking-scope specification §5.3) and `spawn`
(spawn specification §5.4).

---

## 6. Runtime Lifecycle

### 6.1 Resource Entry

When the runtime receives a resource descriptor from the
kernel, it MUST:

R1. **Allocate child coroutineId.** The runtime MUST allocate
    a coroutineId using the deterministic child ID scheme:
    `child_id(parent_id, childSpawnCount)`. The
    `childSpawnCount` is the parent's unified counter across
    all compound-external children (`scope`, `all`, `race`,
    `spawn`, `resource`), incremented at resource creation
    time.

R2. **Create child scope.** The runtime MUST establish a
    structured scope boundary for the resource child. The
    child's lifetime MUST be bounded by the parent scope.

R3. **Drive child kernel through initialization.** The runtime
    MUST create a fresh kernel generator for the resource body
    expression with the inherited execution environment and
    the allocated child coroutineId. The runtime MUST drive
    this kernel, dispatching effects normally (replay or live)
    until the child kernel yields a `provide` descriptor.

R4. **Capture provided value.** When the child kernel yields a
    descriptor with `id: "provide"`, the runtime MUST extract
    the provided value from the descriptor's `data` field.

R5. **Resume parent kernel.** The runtime MUST resume the
    parent kernel with the provided value. The parent
    continues executing.

R6. **Keep child scope alive.** After the parent resumes, the
    resource child scope MUST remain alive. The child kernel
    is suspended at the provide point. The child's structured
    scope boundary remains open.

### 6.2 Provide Handling in Child

When the runtime drives the resource child's kernel and
encounters a `provide` descriptor:

R7. **No YieldEvent.** The runtime MUST NOT write a
    `YieldEvent` for the `provide` operation. This
    specification establishes that `provide` is a coordination
    mechanism between the child and the runtime, not an
    external effect. It does not represent an agent
    interaction and has no independent replay identity.

R8. **No yieldIndex advance.** The runtime MUST NOT advance
    the child's yieldIndex for `provide`. This is a
    consequence of R7: only `YieldEvent`-producing operations
    advance the index.

R9. **Child suspension.** After capturing the provided value,
    the runtime MUST NOT resume the child kernel from the
    provide suspension. The child kernel remains suspended
    until teardown (§6.3) or cancellation (§6.5).

### 6.3 Teardown (Normal)

When the parent scope exits normally (by returning a value or
by propagating an error), the resource child scope MUST be
torn down.

R10. **Resume from provide.** The runtime MUST resume the
     child kernel from its suspension at the provide point.
     The child kernel continues executing past `provide`,
     entering any `finally` block.

R11. **Drive cleanup.** The runtime MUST drive the child
     kernel through cleanup. Effects dispatched during cleanup
     (e.g., agent calls in `finally` blocks) MUST be
     dispatched normally (replay or live) and journaled under
     the child's coroutineId. Cleanup effects continue the
     same yieldIndex sequence as initialization effects.

R12. **Write CloseEvent.** When the child kernel completes
     (returns or exhausts cleanup), the runtime MUST write a
     `CloseEvent` for the child's coroutineId.

> **Draft implementation note.** R10–R12 define the semantic
> contract: cleanup code runs during teardown, cleanup effects
> are journaled, and the child closes. The mechanism by which
> the runtime resumes a child kernel from a compound-external
> suspension point is implementation-defined and subject to
> prototype validation during the draft stage. See §11 for
> the specific validation criteria. The semantic commitments
> are stable regardless of mechanism.

### 6.4 Failure

**Init failure (before provide).**

R13. If the child kernel throws before reaching the provide
     point, the resource initialization has failed. The
     runtime MUST propagate the error to the parent kernel
     via `.throw(error)`. The parent's `try/catch` around
     `yield* resource(...)` catches the error.

R14. The runtime MUST write a `CloseEvent` for the child's
     coroutineId with `status: "err"` before propagating the
     error to the parent.

**Background failure (after provide).**

R15. If the resource child scope fails after the parent has
     resumed — through failure of a task spawned within the
     resource body, or through any other error in the
     resource child's structured scope — the parent scope
     MUST be crashed. This follows the same failure
     propagation model as `spawn` child failure (spawn
     specification R12): child failure tears down the parent
     scope unconditionally.

R16. The parent does NOT catch this error via a `try/catch`
     around the original `yield* resource(...)`. The error
     propagates through scope failure, not through the
     parent's yield point.

**Cleanup failure.**

R17. If the child's cleanup code (in a `finally` block) throws
     during teardown, the error MUST be recorded in the
     child's `CloseEvent` with `status: "err"`. The error
     propagates upward through the scope tree per existing
     structured concurrency rules.

### 6.5 Cancellation

This specification makes a conservative choice for v1
regarding cancellation. The guarantees for cancellation are
deliberately weaker than for normal teardown.

R18. When the parent scope is cancelled while the resource
     child is alive (suspended at the provide point or during
     initialization), the child scope MUST be cancelled.

R19. On cancellation, the runtime MUST write a `CloseEvent`
     for the child's coroutineId with `status: "cancelled"`.

R20. This specification does NOT require that the child's
     `finally` blocks execute during cancellation. Whether
     they execute depends on the structured concurrency
     substrate's cancellation behavior.

> **Non-normative.** The asymmetry between normal teardown
> (R10–R12: `finally` blocks guaranteed to execute) and
> cancellation (R20: no such guarantee) is a deliberate v1
> limitation. Normal teardown is initiated by the Tisyn
> runtime, which has full control of the child kernel
> resumption sequence. Cancellation is initiated by the
> substrate and may not provide the runtime an opportunity
> to resume the child kernel before the scope is destroyed.
> A future version MAY strengthen cancellation guarantees
> once the teardown-resumption mechanism is fully validated,
> but this specification does not make that commitment.

### 6.6 Ordering Invariants

R21. **Reverse creation order.** When a parent scope has
     multiple resource children, they MUST be torn down in
     reverse creation order (LIFO). A resource created later
     MUST be fully torn down before an earlier resource begins
     teardown.

R22. **Children before resource.** All children spawned within
     the resource body (via `spawn`, nested `scoped`, or
     nested `resource` within the init phase) MUST be torn
     down before the resource's own cleanup runs.

R23. **Child Close before parent Close.** The resource child's
     `CloseEvent` MUST appear in the journal before the
     parent's `CloseEvent`. This is the existing O5 invariant
     (kernel specification §9.5) applied to the resource
     child.

R24. **Teardown before parent Close.** Resource child teardown
     MUST complete before the parent scope's own `CloseEvent`
     is written.

---

## 7. Journal Ordering

### 7.1 No New Event Types

This specification does NOT introduce new durable event types.
The durable stream remains `YieldEvent | CloseEvent` only.

Resource creation, provide signaling, and scope configuration
are NOT journaled. They are reconstructed from the IR on
replay.

### 7.2 Initialization Events

Effects dispatched within the resource body's initialization
phase produce `YieldEvent`s journaled under the child's
coroutineId. These follow the existing journaling rules:
persist-before-resume (property P1), monotonic yieldIndex
(property O3).

### 7.3 Provide Is Not Journaled

This specification establishes that the `provide` operation
does not produce a `YieldEvent` and does not advance the
child's yieldIndex. The rationale is that `provide` is a
coordination mechanism between the child and the runtime,
not an external effect with an independent replay identity.
The provided value is deterministically recomputable from the
child's replayed initialization (§8.2), making a journal
entry redundant.

### 7.4 Cleanup Events

Effects dispatched during the resource body's cleanup phase
(in `finally` blocks during teardown) produce `YieldEvent`s
journaled under the child's coroutineId. Cleanup effects
continue the same yieldIndex sequence as initialization
effects. The yieldIndex does NOT reset between phases.

This is identical to how cleanup effects work in
`try/catch/finally` (kernel specification §5.12, architecture
§6.6).

### 7.5 Resource in the Parent's Journal

`resource` as a compound-external does NOT advance the
parent's yieldIndex and does NOT produce a `YieldEvent` in
the parent's journal. This specification follows the same
convention established for `scope` (blocking-scope
specification §8.1) and `spawn` (spawn specification J6):
compound-external operations that create child scopes are
structural orchestration; their child effects are journaled
under child coroutineIds.

### 7.6 Ordering Summary

````
[parent: ... effects before resource ...]
[parent: kernel yields resource descriptor]  // no parent YieldEvent
  ── child init ──
  [child: Yield(effect₁, yieldIndex=0)]
  [child: Yield(effect₂, yieldIndex=1)]
  [child: provide]                           // no event, no yieldIndex advance
[parent: resumes with provided value]
[parent: ... effects after resource ...]
  ── parent scope exit, teardown ──
  [child: Yield(cleanup₁, yieldIndex=2)]     // continues sequence
  [child: Close(ok)]
[parent: Close(ok)]                          // after child
````

---

## 8. Replay and Durability

### 8.1 Replay Reconstruction

On replay, the kernel re-evaluates the IR. When it encounters
the resource node, it yields the same descriptor (deterministic
from the immutable IR). The runtime:

RR1. Allocates the same child coroutineId (deterministic from
     `childSpawnCount`).

RR2. Creates a fresh child kernel for the resource body.

RR3. Drives the child kernel. Initialization effects replay
     from the journal under the child's coroutineId via the
     existing per-coroutineId replay cursor.

RR4. The child kernel reaches the `provide` node. Because the
     child's initialization is deterministic (same IR, same
     replayed effect results), the provide expression evaluates
     to the same value as the original run.

RR5. The runtime captures the provided value and resumes the
     parent kernel. The parent receives the same value.

RR6. The child scope is re-established as alive and suspended
     at the provide point.

RR7. Cleanup events, if present in the journal (from a
     previous run's teardown), replay when the parent scope
     exits and teardown runs.

### 8.2 Provided Value Is Recomputed, Not Stored

This specification establishes that the provided value is NOT
stored in the journal. It is recomputed by driving the child
kernel through initialization during replay.

This is sound because:

- Same IR (immutable) → same resource body expression.
- Same journal → same effect results during initialization.
- Same effect results → same kernel execution path.
- Same execution path → same value expression at the provide
  point.
- Same value expression + same environment → same provided
  value.

This follows the same principle applied to `scope`: a scope's
return value is not separately journaled — it is the natural
output of replaying the scope body. The resource child's
provided value is the natural output of replaying the child's
initialization.

### 8.3 Per-CoroutineId Replay Cursors

The existing per-coroutineId replay cursor model (compound
concurrency specification §10.1, spawn specification §8.3)
is sufficient for resource children. Each coroutine — parent
and resource child — has its own independent replay cursor.
No new replay machinery is needed.

### 8.4 Crash Recovery

A crash can occur at several points during resource execution:

- **Crash during initialization (before provide):** Replay
  re-enters the resource body, replays stored init events,
  continues from the last replayed position.

- **Crash after provide, parent still running:** The child is
  suspended at provide. Replay re-drives the child to the
  provide point (replaying init events), captures the same
  value, resumes the parent, and replays the parent's
  subsequent events.

- **Crash during teardown:** Init events replay. Cleanup
  events that were journaled before the crash replay;
  remaining cleanup effects dispatch live.

- **Crash after child Close:** The child's `CloseEvent` is in
  the journal. Replay observes the completed child journal.

---

## 9. Compiler Obligations

### 9.1 `resource(...)` Recognition

The compiler MUST add a new dispatch case in its `yield*`
processing path. When the `yield*` target is a call to
`resource` with a generator function argument, the compiler
MUST:

C1. Enter a resource compilation context.

C2. Compile the inner generator's body via the existing
    statement compilation pipeline.

C3. Verify that constraints RS1–RS6 and P1–P7 are satisfied.

C4. Emit a resource node: `Eval("resource", Quote({ body:
    compiledBody }))`.

### 9.2 `provide(...)` Recognition

For `yield* provide(expr)` inside a resource body, the
compiler MUST:

C5. Verify that the `provide` call is inside a resource body
    (P2).

C6. Verify that this is the only `provide` on the current
    control-flow path (P3).

C7. Verify that the `provide` is at a valid position (P4).

C8. Compile the value expression `expr` via the existing
    expression compilation pipeline.

C9. Emit: `Eval("provide", compiledExpr)`. The value
    expression is NOT wrapped in `Quote`.

### 9.3 Acceptance and Rejection

The compiler MUST reject authored source that violates any
constraint defined in §3 (RS1–RS6, P1–P7) with a diagnostic
that identifies the violated constraint.

The compiler MUST accept authored source that satisfies all
constraints defined in §3 and produce IR conforming to §4.

---

## 10. Relationship to Existing Scope-Creating Operations

### 10.1 Comparison

| Property | `scoped` | `spawn` | `resource` |
|---|---|---|---|
| **Parent blocks** | Until child completes | No | Until provide |
| **Value to parent** | Child return value | Task handle | Provided value |
| **Child lifetime** | Ends before parent resumes | Until parent scope exits | Until parent scope exits |
| **Cleanup model** | Scope teardown | Scope teardown | `finally` from provide point |
| **IR data** | `{ handler, bindings, body }` | `{ body }` | `{ body }` |

`all` and `race` are parent-level compound operations over
multiple child expressions. They are not directly comparable
to `resource`, which operates on a single child scope.

### 10.2 Unified Child ID Allocation

`resource` participates in the parent's unified
`childSpawnCount` counter alongside `scope`, `spawn`, `all`,
and `race`. The counter increments at resource creation time.
Child coroutineIds are deterministic.

### 10.3 `provide` Within the Family

`provide` is not a scope-creating operation. It is a
child-internal coordination form that exists only to support
the resource lifecycle. Within the compound-external ID set,
its closest analogue is `join`: both are coordination
operations that use the compound-external routing path for
kernel-level reasons (avoiding agent dispatch, selecting
`unquote` semantics) without being scope creators themselves.

---

## 11. Draft Implementation Note

> **This section is non-normative.** It identifies a specific
> runtime mechanics question that MUST be validated before
> this specification advances to "Ready for approval" status.

### 11.1 Teardown Resumption

The semantic contract (R10–R12) requires that the resource
child's cleanup code runs during normal teardown: the child
kernel resumes from the provide suspension, `finally` blocks
execute, cleanup effects are dispatched and journaled, and the
child's `CloseEvent` is written.

The exact mechanism by which the runtime resumes a child
kernel that is suspended at a compound-external yield point
is not specified normatively. Conforming implementations MUST
achieve the described semantic behavior; they MAY use any
mechanism that satisfies R10–R12.

### 11.2 Prototype Acceptance Criteria

The following three checks MUST pass before this specification
advances to "Ready for approval":

**Check 1: Normal teardown.** Resource body with one init
agent call and `try { provide(value) } finally { one cleanup
agent call }`. Parent scope exits normally. Verify: init
`YieldEvent` at child yieldIndex 0; cleanup `YieldEvent` at
child yieldIndex 1; child `Close(ok)`; parent `Close(ok)`.
Replay the journal. Same events, same result.

**Check 2: Cancellation.** Resource body with one init agent
call and `provide(value)` (no `try/finally`). Parent scope
cancelled externally. Verify: init `YieldEvent` at child
yieldIndex 0; child `Close(cancelled)`; parent
`Close(cancelled)`. Replay. Same events.

**Check 3: Cleanup failure.** Resource body with one init
agent call and `try { provide(value) } finally { agent call
that throws }`. Parent scope exits normally. Verify: init
`YieldEvent` at child yieldIndex 0; cleanup `YieldEvent` at
child yieldIndex 1 with error result; child `Close(err)`;
error propagates to parent. Replay. Same events.

---

## 12. Deferred Extensions

The following are explicitly out of scope for this
specification version.

### 12.1 Resource with Handler or Bindings

This specification does not allow `resource(...)` to carry
handler or binding metadata directly. A resource body that
needs middleware or transport bindings uses `scoped(...)`
inside its body. A future version MAY combine `resource` +
`scoped` into a single operation with integrated scope
configuration.

### 12.2 Resource Inside `all` / `race`

Resource creation inside `all` or `race` bodies is not
specified. The interaction between resource initialization
barriers and compound join semantics requires further design.

### 12.3 Resource-to-Resource Nesting

A resource body containing another `yield* resource(...)` call
likely works naturally (the inner resource is a child of the
outer resource's scope), but teardown ordering edge cases for
nested resources are not specified in this version.

### 12.4 Transport Binding Migration

Transport bindings are semantically resources (blocking-scope
specification §10.2). Compiling `useTransport` to
resource-backed internals is a future goal. This specification
defines the resource primitive independently; migration is
deferred.

### 12.5 Post-Provide Non-Finally Code

This specification restricts `provide` to be the last
expression on its path (P6). A future version MAY allow
arbitrary code after `provide` that runs during teardown, not
just `finally` blocks.

### 12.6 Multi-Provide / Streaming Resources

Resources that provide multiple values over time require a
fundamentally different pattern. Deferred.

### 12.7 Explicit Resource Disposal

Allowing the parent to explicitly dispose a resource before
scope exit would break the structured lifetime model. Deferred
unless a compelling use case emerges.

### 12.8 Cancellation Cleanup Guarantees

R20 deliberately does not guarantee `finally` execution during
cancellation. Strengthening this guarantee is deferred until
the teardown-resumption mechanism is validated and the
interaction with the structured concurrency substrate's
cancellation model is fully understood.
