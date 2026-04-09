# Tisyn Stream Iteration Specification

**Version:** 0.1.0  
**Implements:** Tisyn System Specification 1.0.0  
**Amends:** Tisyn Compiler Specification 1.2.0  
**Extends:** Tisyn Spawn Specification 0.1.0 (restricted capability-value pattern)  
**Depends on:** Tisyn Blocking Scope Specification 0.1.0, Tisyn Runtime Specification for Compound Concurrency 1.3.2, Tisyn Kernel Specification 1.0.0 (replay model only; no kernel changes required)  
**Status:** Draft

---

## 1. Overview

This specification defines a constrained stream-iteration
facility for authored Tisyn workflows. It covers the authored
surface, the IR lowering, the external effect family, the
capability-value model, the runtime lifecycle, and the replay
semantics for the `for (const x of yield* each(source)) { ... }`
form.

The target authored surface is:

````typescript
for (const order of yield* each(source)) {
  yield* OrderService().process(order);
}
````

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- authored-language rules for the constrained `for...of` stream
  iteration form
- the external effect types `stream.subscribe` and `stream.next`
- the stream subscription handle as a restricted capability value
- compiler recognition and lowering of the accepted `for...of`
  form to recursive Fn + Call with stream external effects
- runtime subscription lifecycle: creation, item retrieval,
  scope-bound teardown
- replay semantics: journaled item replay, live-frontier
  subscription creation, non-resumable recovery model

### 1.3 What This Specification Does Not Define

This specification does NOT define:

- A general durable or resumable stream abstraction. The MVP
  stream-iteration facility does not provide exact cursor-based
  recovery across crash/replay. See §9 for the precise replay
  contract.
- User-authored `each.next()`. Iteration advancement is
  compiler-internal lowering. `each.next()` is not part of the
  Tisyn authored language and MUST be rejected by the compiler.
- General `for...of` support. Only the constrained form
  `for (const x of yield* each(expr)) { ... }` is accepted.
  All other `for...of` usage remains rejected under E013.
- Stream transformation operators (map, filter, flatMap).
- Fan-out or multi-subscriber streams.
- Continue-as-new or journal compaction for unbounded streams.

### 1.4 Relationship to Other Specifications

This specification amends the compiler specification by:
adding the constrained `for...of` form to §2.1 (Allowed
Constructs), narrowing E013 to exclude the accepted stream
iteration form, and adding a new §6.N (Stream Iteration).

This specification defines the reserved external effect IDs
`stream.subscribe` and `stream.next` for this feature. These
are standard external effects — not structural or compound
effects. They follow the generic external evaluation path
already defined by the system specification (§7.4). This
specification does not amend the system specification's
external effect machinery; it introduces two new effect IDs
that use it. This specification also extends the restricted
capability-value pattern introduced by the spawn specification
(§2) to cover stream subscription handles.

It depends on the blocking scope specification for
scope-bound subscription lifetime. It depends on the runtime
replay model defined by the compound concurrency specification
(§10.1–10.5) and the kernel specification (§10.1–10.5) for
per-coroutineId replay cursors and the existing replay
matching algorithm. Stream effects participate in this
existing replay model without modification.

This specification does NOT require kernel semantic changes.
The kernel evaluator, the suspend/resume contract, the replay
matching algorithm, and the environment model are unchanged.
The kernel handles `stream.subscribe` and `stream.next` via
the existing standard external effect path.

### 1.5 Key Design Decisions

This MVP makes the following concrete choices:

- `for (const x of yield* each(source)) { ... }` compiles to
  recursive Fn + Call with `stream.subscribe` and `stream.next`
  external effects.
- Stream subscription handles are restricted capability values,
  same category as spawn task handles. They MUST NOT be
  serialized, returned, passed to agents, or stored in compound
  values.
- Replay does not provide cursor-based resumption. At the live
  frontier, the runtime creates a fresh Effection subscription.
  What the fresh subscription produces is determined by the
  source, not by Tisyn.
- Item delivery is at-least-once. Duplicate processing of the
  last pre-crash item is possible.
- Crash-window loss is possible for volatile push sources.
- No new durable event types are introduced. Stream effects
  produce standard `YieldEvent` entries.
- No kernel semantic expansion is required.

---

## 2. Terminology

**Stream source.** An Effection `Stream<T, TClose>` or a value
that the runtime can evaluate into one. The stream source is
provided by the authored expression in the `each(...)` call.
The stream source is an external, non-deterministic entity
whose behavior Tisyn does not control.

**Stream iteration.** The consumption of items from a stream
source within a compiled loop. Each item retrieval is a
separate external effect that suspends the kernel and produces
a `YieldEvent`.

**Stream subscription handle.** A restricted capability value
produced by the `stream.subscribe` external effect. Its runtime
representation is `{ __tisyn_subscription: string }`. It is
used internally by the lowered IR to reference the subscription
when calling `stream.next`. It is not visible in the authored
source.

**Restricted capability value.** A subclass of `Val` with
constrained usage. It MAY be bound in the kernel environment
via `Let` and referenced via `Ref`. It MUST NOT be serialized,
stored in the journal, included in effect data passed to
agents, returned as a workflow result, or included in compound
values (objects, arrays). It is ephemeral: it exists only
during one execution. On replay, the runtime reconstructs a
semantically equivalent capability value at the same program
point. The spawn specification introduced this concept for task
handles; this specification extends it to stream subscription
handles.

**Live frontier.** The point during replay at which the replay
index has no more journal entries for the current coroutine's
next yieldIndex. At the live frontier, the runtime transitions
from replaying journaled results to dispatching effects live.
For stream iteration, this is the point at which the runtime
creates a real Effection subscription.

**Duplicate-prone.** A recovery classification where items
that were already processed before a crash may be re-delivered
and re-processed after replay. This occurs because the fresh
subscription at the live frontier may produce items that
overlap with already-journaled items. Conforming under the
at-least-once delivery contract.

**Lossy-but-allowed.** A recovery classification where items
produced by the source during the crash window are lost because
no subscription existed to receive them. Conforming under the
MVP non-resumable contract. Applies to volatile push sources.

**Exact cursor-based recovery.** A replay model where the
runtime resumes stream consumption from the precise item after
the last successfully processed item. This specification does
NOT provide exact cursor-based recovery.

---

## 3. Normative Scope and Non-Goals

### 3.1 Applicability

`each(...)` is appropriate when:

- The source's re-subscription semantics are acceptable under
  at-least-once or lossy recovery.
- Loop bodies are idempotent or otherwise duplicate-safe.
- Crash-window loss is acceptable if the source is volatile.
- The stream is scope-bound and does not need to survive
  independently of its parent workflow scope.

`each(...)` is NOT appropriate when:

- Exact recovery from the last processed item is required.
- The source must resume from a durable cursor, offset, or
  broker token.
- Duplicate processing is not acceptable.
- Crash-window loss is not acceptable.

### 3.2 Alternative for Exact Recovery

Workflows that require exact cursor-based recovery MUST model
the cursor as ordinary workflow state and perform item
retrieval through explicit effects:

````typescript
function* fetchAllPages(): Workflow<void> {
  let cursor = 0;
  while (true) {
    const page = yield* API().fetchPage(cursor);
    if (page.items.length === 0) return;
    yield* processPage(page);
    cursor = page.nextCursor;
  }
}
````

In this pattern, `cursor` is ordinary workflow state — a
value bound via `let` and advanced through SSA reassignment.
On replay, the cursor's value is reconstructed from the
sequence of prior journaled effect results, the same way any
other workflow variable is reconstructed. There is no special
cursor-management mechanism; exact recovery depends on the
retrieval effect's own contract (i.e., whether
`API().fetchPage(cursor)` returns deterministic results for a
given cursor value).

### 3.3 Explicit Non-Goals

NG1. General `for...of` compilation.  
NG2. User-authored `each.next()`.  
NG3. Cursor-based resumption.  
NG4. Exactly-once item processing.  
NG5. Continue-as-new or journal compaction.  
NG6. Fan-out or multi-subscriber streams.  
NG7. Stream transformation operators.  
NG8. Nested `for yield* each` (multiple active subscriptions
     within one coroutine). The inner loop runs to completion
     before the outer loop advances, so execution is
     sequential, not concurrent. However, the interleaving of
     `stream.next` journal entries from two subscriptions
     within one coroutineId has not been validated against
     the replay matching algorithm. Deferred pending prototype
     validation.  
NG9. Destructuring in the `for` binding.

---

## 4. Authored-Language Rules

This section amends Compiler Specification §2.1 and §6.6.

### 4.1 Amendment to §2.1 (Allowed Constructs)

Add one row to the constructs table:

| Construct | Authoring form | IR |
|---|---|---|
| Stream iteration | `for (const x of yield* each(s)) { ... }` | Recursive Fn + Call with `stream.subscribe` / `stream.next` external effects |

### 4.2 Amendment to §6.6

Current text:

> DISALLOWED. No IR equivalent.

And the current error table includes:

> E013: `for...in` / `for...of` is not allowed

Amended text:

> `break`, `continue`, `for...in`: DISALLOWED. No IR
> equivalent.
>
> `for...of`: DISALLOWED except for the constrained stream
> iteration form defined in §6.N. Error E013 remains active
> for all other `for...of` usage.

### 4.3 Accepted Syntax (§6.N.1)

The compiler MUST accept exactly one `for...of` form:

````
for (const <identifier> of yield* each(<expr>)) {
  <bodyStatements>
}
````

Where:

SI1. `<identifier>` MUST be a single identifier. Destructuring
     patterns MUST be rejected (E-STREAM-002).

SI2. `<expr>` MUST be any expression accepted by the existing
     expression compilation pipeline.

SI3. `<bodyStatements>` MUST be zero or more statements drawn
     from the existing authoring subset.

SI4. The loop body MUST NOT include `yield* each.next()` or any
     form of `each.next()`. The compiler MUST reject any
     occurrence of `each.next()` in authored source with
     E-STREAM-005.

The compiler automatically appends the recursive `Call` that
advances to the next stream item after the compiled body.
Iteration advancement is compiler-internal lowering, not an
authored construct.

### 4.4 Rejected Syntax (§6.N.2)

| Form | Error | Rule |
|---|---|---|
| `for (let x of yield* each(s)) { ... }` | E-STREAM-001 | SI1: `const` required |
| `for (const {a, b} of yield* each(s)) { ... }` | E-STREAM-002 | SI1: destructuring deferred |
| `for (const x of each(s)) { ... }` | E-STREAM-003 | Missing `yield*` |
| `for (const x of yield* someOtherFn(s)) { ... }` | E013 | General `for...of` disallowed |
| `for (const x of yield* each(s)) { ... continue; }` | E020 | `continue` disallowed |
| `for (const x of yield* each(s)) { ... break; }` | E020 | `break` disallowed |
| `const sub = yield* each(s);` | E-STREAM-004 | `each()` outside `for...of` |
| `yield* each.next();` | E-STREAM-005 | `each.next()` not in authored language |
| Nested `for yield* each` | E-STREAM-006 | Deferred (NG8) |

### 4.5 Interaction with Existing Rules

The `yield*` in `yield* each(expr)` is the iterable expression
of the `for...of`, not a statement-position `yield*`. Rule E010
("yield* must appear in statement position only") does NOT
apply here because the `for...of` header is not a statement.
The compiler MUST handle this form as a recognized pattern
before applying E010.

---

## 5. Semantic Model

### 5.1 Feature Classification

MVP stream iteration is a **constrained stream-iteration
facility** with non-resumable replay semantics. It is NOT a
general exact-resumption durable stream abstraction.

### 5.2 Source Classes

The MVP is conforming for two classes of stream sources. The
authored surface does not distinguish them syntactically. The
distinction is in the source's behavioral contract, which the
source implementor documents.

**Class 1: Idempotent-resubscribe sources.** Subscribing from
scratch at any point produces a sequence that starts from the
beginning or from a deterministic position.

Examples: paginated APIs with internal cursor tracking,
database queries returning a snapshot, bounded in-memory
sequences.

Recovery behavior: at the live frontier, the fresh subscription
may re-deliver items that were already processed. Duplicate
processing is possible.

**Class 2: Volatile push sources.** Items are produced
asynchronously by an external system. Resubscription connects
to the live stream at whatever point the source has reached.

Examples: WebSocket message streams, SSE event streams without
server-side replay, Effection signals.

Recovery behavior: items produced during the crash window are
lost. The fresh subscription produces whatever the source
produces next, which may have an arbitrary gap relative to the
last journaled item.

### 5.3 Correctness Properties by Class

| Property | Class 1 | Class 2 |
|---|---|---|
| Items journaled before crash | Replayed exactly | Replayed exactly |
| Items fetched but not journaled | Re-fetched (at-least-once) | Lost if source advanced |
| Items produced during crash window | Available on resubscription | **Lost** |
| Item ordering within a session | Preserved | Preserved |
| Item ordering across crash boundary | Preserved | **Gap possible** |
| Duplicate processing | **Possible** | Possible for last pre-crash item |

---

## 6. Capability-Value Model

### 6.1 Amendment Statement

A stream subscription handle is a **restricted capability
value**, same category as the spawn task handle (Spawn
Specification §2). This extends the restricted
capability-value pattern to a second type of handle. The
System Specification's value model (§3, §4) defines `Val`
generically; the spawn specification introduced the concept
of restricted capability values as a constrained subclass.
This specification applies the same restriction pattern to
stream subscription handles.

### 6.2 Representation

````
{ __tisyn_subscription: string }
````

The string MUST be derived deterministically from `coroutineId`
and a monotonic subscription counter within that coroutine.

### 6.3 Restriction Table

| Where | Permitted? | Enforced by |
|---|---|---|
| Bind via `Let` / reference via `Ref` | **Yes** | — |
| Pass to `stream.next` as effect data | **Yes** | Runtime resolves handle |
| Pass as argument to agent method | **No** | Compiler / Runtime |
| Return from workflow | **No** | Compiler / Runtime |
| Store in object or array | **No** | Compiler / Runtime |
| Include in journal event result value | **No** | Runtime |
| Cross agent boundary | **No** | Runtime |
| Survive replay as a plain value | **No** | Reconstructed |
| Pass to spawned body via lexical capture | **Yes** | Call-site resolution |

Lexical capture into a spawned body is permitted because the
spawned child executes within its parent's Effection scope
(Spawn Spec §6.1 R3). The subscription's Effection lifetime
is bounded by the parent scope, and the child's scope is
bounded by the same parent scope. The child cannot outlive
the subscription. This is the same reasoning that permits
spawned bodies to reference other parent-scope bindings via
`Ref` and call-site resolution (Spawn Spec §3.5, SP11(A)).

### 6.4 Compiler Enforcement

For compiled authored code, the compiler controls the handle's
entire lifecycle. The handle is bound to a compiler-generated
synthetic name (`__sub_N`) that never appears in the authored
source. The `for yield* each(...)` pattern is recognized and
lowered as a unit. The author never has access to the handle
variable, so escape is structurally impossible.

### 6.5 Runtime Enforcement

For hand-constructed IR, the runtime MUST validate:

RV1. At `stream.next` dispatch: the handle's originating
     `coroutineId` MUST be an ancestor-or-equal of the current
     `coroutineId`.

RV2. At any standard external effect dispatch: the resolved
     data MUST NOT contain a value with a
     `__tisyn_subscription` field. If it does, the runtime
     MUST reject with a descriptive error.

RV3. At `Close(ok, value)`: the close value MUST NOT contain
     a `__tisyn_subscription` field.

### 6.6 Replay Reconstruction

During replay, the runtime MUST return the journaled handle
value when the kernel yields `stream.subscribe`. The handle
value is deterministic (derived from `coroutineId` and
subscription counter). No Effection subscription object exists
during replay. The handle is a token that the replay path uses
to match subsequent `stream.next` journal entries.

At the live frontier, the runtime creates a real Effection
subscription and associates it with the handle token. The
kernel does not observe this transition.

---

## 7. IR and Lowering Model

### 7.1 Authored Form

````typescript
for (const order of yield* each(source)) {
  yield* OrderService().process(order);
}
````

### 7.2 Lowered IR Shape

The compiler MUST lower the accepted form to the following
IR structure:

````
Let("__sub_N",
  Eval("stream.subscribe", [⟦expr⟧]),
  Let("__loop_N",
    Fn([],
      Let("__item_N",
        Eval("stream.next", [Ref("__sub_N")]),
        If(
          Get(Ref("__item_N"), "done"),
          null,
          Let("<identifier>",
            Get(Ref("__item_N"), "value"),
            Let("__discard_N",
              ⟦bodyStatements⟧,
              Call(Ref("__loop_N"), [])
            )
          )
        )
      )
    ),
    ⟦Call site⟧
  )
)
````

### 7.3 Lowering Components

**Subscription creation.** `Eval("stream.subscribe", [⟦expr⟧])`
creates the subscription. The resolved expression is the stream
source definition. The runtime returns a capability handle. The
handle is bound to `__sub_N`.

**Item retrieval.** `Eval("stream.next", [Ref("__sub_N")])`
retrieves the next item. The runtime returns
`{ done: false, value: <item> }` or `{ done: true }`.

**Loop termination.** `If(Get(Ref("__item_N"), "done"), null, ...)`
terminates the recursive loop when the source signals done.
The `If` takes the then-branch (`null`), which propagates out
through the `Call` chain as the loop result.

**Iteration advancement.** `Call(Ref("__loop_N"), [])` at the
end of the else-branch body recurses to the next iteration.
This is compiler-internal lowering. No authored construct
produces this `Call`.

**Stream close.** The subscription is closed by scope teardown.
No explicit `stream.close` effect is emitted in the IR. The
runtime's Effection scope owns the subscription; when the scope
exits, Effection halts the subscription via structured
concurrency.

### 7.4 Validity Under Current Semantics

L1. **Self-reference.** `Ref("__loop_N")` resolves via
    call-site resolution (Architecture §5.4). This is the
    same mechanism used by all existing while-with-return
    loops (Compiler Spec §6.2, Case B).

L2. **External effects inside Fn body.** Confirmed by
    Architecture §5.4: the kernel suspends and resumes
    transparently when the Fn body contains external Eval
    nodes.

L3. **Free variable capture.** `Ref("__sub_N")` resolves in
    the caller's environment via call-site resolution.

L4. **Journal trace.** Each iteration produces exactly one
    `YieldEvent` for `stream.next` plus whatever effects the
    body contains. `Fn` and `Call` are structural — they
    produce no journal events.

### 7.5 Post-Loop Continuation

Code after the loop uses the standard
`Let("__discard_N", <loop>, <continuation>)` pattern. The loop
returns `null` when done. The continuation evaluates normally.

If the loop body contains `return`, the existing
`__tag`/`__value` outcome-packing mechanism (Compiler Spec
§6.7.1) applies identically.

### 7.6 Call Site Convention

The `⟦Call site⟧` follows the standard Case B calling
convention:

- If the loop is the last statement:
  `Call(Ref("__loop_N"), [])`.
- If the loop is followed by continuation statements:
  `Let("__discard_N", Call(Ref("__loop_N"), []), ⟦continuation⟧)`.
- If the loop body contains `return` and the loop is not last:
  dispatch on `__tag` per Compiler Spec §6.2.

---

## 8. External Effect Surface

### 8.1 `stream.subscribe`

**Effect ID:** `"stream.subscribe"`

**Input (resolved data):** An array containing the stream
source definition. The source definition is a serializable
value produced by compiling the `<expr>` in
`yield* each(<expr>)`.

**Output:** A stream subscription handle
`{ __tisyn_subscription: string }`.

**Capability:** Yes. The output is a restricted capability
value (§6).

**Replayable:** Yes. The runtime MUST replay from journal
(CASE 1) when a matching `YieldEvent` exists. No Effection
subscription is created during replay.

**Journal description:** `{ type: "stream", name: "subscribe" }`.

### 8.2 `stream.next`

**Effect ID:** `"stream.next"`

**Input (resolved data):** An array containing the subscription
handle (a `{ __tisyn_subscription: string }` value obtained
from a prior `stream.subscribe`).

**Output:** An iterator result value:
- `{ done: false, value: <serialized item> }` — item available.
- `{ done: true }` — stream exhausted.

**Capability:** No. The output is an ordinary serializable
value.

**Replayable:** Yes. The runtime MUST replay from journal
(CASE 1) when a matching `YieldEvent` exists. During replay,
no Effection `subscription.next()` call is made.

**Journal description:** `{ type: "stream", name: "next" }`.

**Error handling:** If the Effection subscription produces an
error, the runtime MUST journal a `YieldEvent` with
`status: "error"` and resume the kernel with an error. The error
propagates through normal error handling.

### 8.3 Classification

`stream.subscribe` and `stream.next` are standard external
effects. They are NOT compound external operations. They use
`resolve`, not `unquote`. They MUST NOT be added to
`COMPOUND_EXTERNAL_IDS`.

`classify("stream.subscribe")` MUST return `EXTERNAL`.  
`classify("stream.next")` MUST return `EXTERNAL`.

---

## 9. Replay and Live-Frontier Semantics

### 9.1 Non-Resumable Recovery

**NR1.** This MVP does NOT provide exact resumable stream
consumption across crash/replay. After a crash, the runtime
creates a fresh subscription that has no knowledge of previously
consumed items. Duplicates and gaps are possible depending on
the source class.

**NR2.** The runtime does NOT persist, track, or use a resume
cursor, offset, or broker token for stream subscriptions.

**NR3.** Continue-as-new and journal compaction are out of
scope. Unbounded streams produce unbounded journals with
linear replay cost.

### 9.2 Replay Mechanism

Stream effects participate in the existing replay matching
algorithm without modification. The algorithm is defined in
the kernel specification (§10.2) and implemented by the
runtime (Compound Concurrency Spec §10.1–10.5). The three
cases apply to stream effects identically to any other
standard external effect:

- CASE 1 (entry exists, description matches): return journaled
  result. No Effection subscription created or called.
- CASE 2 (entry absent, close exists): divergence error.
- CASE 3 (entry absent, no close): live frontier — dispatch
  live.

### 9.3 Live-Frontier Transition

When the kernel yields a `stream.next` effect descriptor and
the replay matching algorithm reaches CASE 3:

**Step 1.** The runtime MUST check whether a live Effection
subscription exists for this handle.

**Step 2a.** If no live subscription exists (first live
`stream.next` after replay): the runtime MUST create the
Effection subscription. The runtime evaluates the stream
definition — deterministically re-resolved from the IR and
environment during replay — to obtain a live Effection
`Stream`. The runtime subscribes via `yield* stream` within
the current task's Effection scope. The resulting
`Subscription` is stored in the runtime's handle map.

**Step 2b.** If a live subscription already exists (second or
subsequent live `stream.next`): proceed to Step 3.

**Step 3.** The runtime MUST call `yield* subscription.next()`.

**Step 4.** The runtime MUST journal the result as a standard
`YieldEvent` (persist-before-resume, P1) and resume the kernel.

### 9.4 Source-Class Recovery Behavior

**Class 1 (idempotent-resubscribe):** The fresh subscription
at Step 2a may produce items that overlap with already-
journaled items. The kernel does not detect this overlap. The
loop body processes whatever item the source produces next.
Duplicate processing is possible.

**Class 2 (volatile push):** The fresh subscription at Step 2a
connects to the live source at whatever position the source
has reached. Items produced during the crash window are lost.
The kernel does not detect the gap.

### 9.5 Worked Example: Pull-Based Idempotent Source

````
Fresh execution:
  subscribe → handle              [Y: stream.subscribe]
  next → { done:false, value: p1 } [Y: stream.next]
  body effects for p1              [Y: ...]
  next → { done:false, value: p2 } [Y: stream.next]
  body effects for p2              [Y: ...]
  ── CRASH ──

Replay:
  subscribe → replayed handle      (CASE 1)
  next → replayed p1               (CASE 1)
  body → replayed                  (CASE 1)
  next → replayed p2               (CASE 1)
  body → replayed                  (CASE 1)
  next → CASE 3: LIVE FRONTIER
    Fresh subscription restarts from beginning
    subscription.next() produces p1 again

Classification: DUPLICATE-PRONE, conforming.
Body MUST be idempotent.
````

### 9.6 Worked Example: Volatile Push Source

````
Fresh execution:
  subscribe → handle              [Y: stream.subscribe]
  next → { done:false, value: m1 } [Y: stream.next]
  body effects for m1              [Y: ...]
  next → { done:false, value: m2 } [Y: stream.next]
  ── CRASH (before body effects for m2 journaled) ──

Replay:
  subscribe → replayed handle      (CASE 1)
  next → replayed m1               (CASE 1)
  body → replayed                  (CASE 1)
  next → replayed m2               (CASE 1)
  body for m2 → CASE 3: LIVE FRONTIER
    Body effects re-execute (at-least-once for m2)
  next → CASE 3: LIVE
    New connection receives m5
    (m3, m4 lost during crash window)

Classification: LOSSY-BUT-ALLOWED, conforming.
````

### 9.7 Worked Example: Exact Cursor Recovery Required

A workflow requires exact cursor-based pagination across
crashes.

````
This source class is NOT appropriate for each(...).

The author MUST use explicit cursor management:

  let cursor = 0;
  while (true) {
    const page = yield* API().fetchPage(cursor);
    if (page.items.length === 0) return;
    yield* processPage(page);
    cursor = page.nextCursor;
  }

Classification: NOT IN SCOPE for each(...).
````

### 9.8 Worked Example: Clean Replay-to-Live After N Items

````
Journal state:
  [Y: stream.subscribe → handle]
  [Y: stream.next → item0] [Y: body-effect-0]
  ...
  [Y: stream.next → item4] [Y: body-effect-4]
  (no more entries)

Replay: iterations 0-4 all replayed from journal (CASE 1).

Iteration 5: kernel yields stream.next
  ReplayIndex cursor past all entries
  No entry → no close → CASE 3 → LIVE
  Runtime creates subscription, calls next()
  Source produces next available item
  Runtime journals and resumes

Classification: CONFORMING.
````

---

## 10. Runtime Responsibilities

### 10.1 Subscription Lifecycle

R1. When the runtime receives a `stream.subscribe` descriptor
    during live execution, it MUST:
    (a) generate a deterministic handle token derived from
        `coroutineId` and a monotonic subscription counter;
    (b) evaluate the stream source definition to obtain an
        Effection `Stream`;
    (c) subscribe to the stream within the current task's
        Effection scope;
    (d) store the subscription in the runtime's handle map
        keyed by handle token;
    (e) return the handle to the kernel.

R2. When the runtime receives a `stream.subscribe` descriptor
    during replay (CASE 1), it MUST return the journaled handle
    value without creating an Effection subscription.

R3. When the runtime receives a `stream.next` descriptor during
    live execution, it MUST:
    (a) look up the subscription by handle token;
    (b) call `yield* subscription.next()`;
    (c) journal the result as a `YieldEvent` (P1);
    (d) return the result to the kernel.

R4. When the runtime receives a `stream.next` descriptor during
    replay (CASE 1), it MUST return the journaled result without
    calling `subscription.next()`.

R5. At the live frontier (first `stream.next` hitting CASE 3
    for a given handle), the runtime MUST create the Effection
    subscription per §9.3 Step 2a before proceeding.

### 10.2 Scope-Bound Teardown

R6. The subscription's Effection scope MUST be a child of the
    enclosing task's Effection scope. When the enclosing scope
    exits (completion, error, or cancellation), the subscription
    is halted by Effection's structured concurrency guarantees.

R7. Cancellation of the enclosing scope while a `stream.next`
    call is in flight MUST cancel the `subscription.next()`
    operation. No item MUST be journaled for a cancelled
    retrieval.

R8. The runtime MUST remove the handle-map entry when the
    subscription is torn down.

### 10.3 Capability Enforcement

R9. The runtime MUST enforce the capability-value restrictions
    defined in §6.5 (RV1–RV3) for hand-constructed IR.

---

## 11. Compiler Responsibilities

### 11.1 Pattern Recognition

C1. The compiler MUST recognize the constrained `for...of` form
    defined in §4.3.

C2. The compiler MUST reject all forms listed in §4.4 with the
    specified error codes.

C3. The compiler MUST reject any occurrence of `each.next()` in
    authored source with E-STREAM-005.

### 11.2 Lowering

C4. The compiler MUST emit the IR structure defined in §7.2.

C5. The compiler MUST append the recursive
    `Call(Ref("__loop_N"), [])` automatically after the compiled
    body. This `Call` is not derived from any authored construct.

C6. The compiler MUST use the compiler's monotonic
    synthetic-name counter for `__sub_N`, `__loop_N`,
    `__item_N`, and `__discard_N`. These names MUST NOT collide
    with user bindings (enforced by existing E028: names starting
    with `__` are reserved).

C7. If the loop body contains `return`, the compiler MUST apply
    the existing `__tag`/`__value` outcome-packing mechanism
    (Compiler Spec §6.7.1).

### 11.3 Call Site Convention

C8. The compiler MUST follow the standard Case B calling
    convention defined in §7.6.

### 11.4 Interaction with E010

C9. The `yield*` in `yield* each(expr)` MUST NOT trigger E010.
    The compiler MUST handle the constrained `for...of` form as
    a recognized pattern before applying the statement-position
    rule.

---

## 12. Kernel Responsibilities

The kernel requires no changes for this specification.

K1. `stream.subscribe` and `stream.next` are standard external
    effects. The kernel handles them via the existing
    `eval_external` path: `resolve(data, E)` →
    `SUSPEND(descriptor)` → resume with result.

K2. The kernel does not know what a "stream" is. It treats
    stream effects identically to any other standard external
    effect.

K3. No new entries are required in `STRUCTURAL_IDS` or
    `COMPOUND_EXTERNAL_IDS`.

K4. No changes to the kernel evaluator, the suspend/resume
    contract, the replay matching algorithm, or the environment
    model are required.

---

## 13. MVP Contract

### 13.1 Guarantees

**G1.** Every stream item retrieved via `stream.next` is durably
journaled before the kernel resumes with that item's value.
(Existing persist-before-resume invariant P1.)

**G2.** Replay of a journaled stream produces the identical
sequence of item values and done signals. (Existing replay
determinism.)

**G3.** Stream subscription lifetime does not exceed the
enclosing Effection scope lifetime. Scope teardown tears down
the subscription. No orphan subscriptions.

**G4.** Cancellation of the enclosing scope cancels the
in-flight `stream.next` effect. No item is journaled for a
cancelled retrieval.

**G5.** Item delivery order within a single execution session
(fresh or post-replay) matches the source's production order.

### 13.2 Non-Guarantees

**NG1.** This MVP does not provide exact resumable stream
consumption across crash/replay.

**NG2.** Exactly-once item processing is not guaranteed. Body
effects may execute more than once for the last pre-crash item.
Delivery is at-least-once.

**NG3.** Lossless delivery for volatile push sources across a
crash boundary is not guaranteed. Items produced during the
crash window are lost.

**NG4.** Cursor-based resumption is not provided. The runtime
creates a fresh subscription at the live frontier.

**NG5.** Bounded journal growth is not guaranteed. Unbounded
streams produce unbounded journals.

### 13.3 Author Obligations

**O1.** Loop bodies MUST be idempotent. Agent methods called
within the loop body may execute more than once for the same
item.

**O2.** Workflows that require exact cursor-based recovery MUST
model the cursor as ordinary workflow state and retrieve items
via explicit effects rather than `each(...)`.

**O3.** Authors requiring lossless delivery from push sources
MUST use an external replay log that supports cursor-based
resubscription, accessed via activities rather than `each()`.

**O4.** Authors SHOULD use bounded stream sources for MVP.
Unbounded streams produce unbounded journals with linear replay
cost.

### 13.4 Out of Scope

- `StreamItemProcessed` checkpoint (exactly-once refinement)
- Continue-as-new / journal compaction
- Cursor-based resumption as a built-in runtime capability
- Fan-out / multi-subscriber streams
- Stream transformation operators (map, filter, flatMap)
- Nested `for yield* each`
- Destructuring in the `for` binding
- User-authored `each.next()`

---

## 14. Conformance Hooks

### 14.1 Compiler Conformance

A conforming compiler MUST:

CT1. Accept the constrained `for...of` form (§4.3) and produce
     the IR structure defined in §7.2.

CT2. Reject all forms listed in §4.4 with the correct
     violated-rule category.

CT3. Reject `each.next()` anywhere in authored source with
     E-STREAM-005.

CT4. Produce structurally valid IR where `__sub_N`, `__loop_N`,
     `__item_N`, and `__discard_N` are bound before reference.

### 14.2 Runtime Conformance

A conforming runtime MUST:

RT1. Handle `stream.subscribe` as a standard external effect
     that returns a capability handle (R1).

RT2. Handle `stream.next` as a standard external effect that
     returns an iterator result (R3).

RT3. Replay both effects from journal when entries exist (R2,
     R4).

RT4. Create a real Effection subscription at the live frontier
     (R5).

RT5. Tear down subscriptions on scope exit (R6).

RT6. Cancel in-flight `stream.next` on scope cancellation (R7).

RT7. Reject capability-value escape in hand-constructed IR
     (R9).

### 14.3 Recovery Conformance

A conformance test suite MUST verify:

RCT1. Replay of N journaled stream items produces the same
      item values in the same order.

RCT2. At the live frontier, the runtime creates a subscription
      and delivers the source's next item.

RCT3. Cancellation during `stream.next` produces no journal
      entry for the cancelled item.

RCT4. Scope teardown tears down the subscription (no orphan
      subscriptions observable via subsequent effects).

RCT5. A capability handle in agent effect data is rejected by
      the runtime.

### 14.4 Explicitly Not Tested

Conformance tests MUST NOT verify:

- Exact item identity across crash/replay boundaries (not
  guaranteed by NR1).
- Lossless delivery from volatile push sources (not guaranteed
  by NG3).
- Cursor-based resumption (not provided by NG4).

---

## 15. Open Questions

**OQ1. Nested `for yield* each`.** Can two `for yield* each`
loops be nested within the same coroutine? The lowering is
straightforward (two `__sub_N` bindings). The inner loop runs
to completion before the outer loop advances, so execution is
sequential. However, the interleaving of `stream.next` journal
entries from two subscriptions within one coroutineId has not
been validated against the replay matching algorithm. The
yieldIndex sequence is deterministic (inner loop effects
appear before outer loop's next `stream.next`), but this has
not been confirmed by prototype. Recommendation: validate via
prototype, then add as an accepted form. Reject in MVP
compiler with E-STREAM-006 until validated.

---

## Final Approval Cleanup

This section documents the exact wording and consistency
fixes applied in this pass. No design changes were made.

**Fix 1 — Kernel/replay dependency inconsistency (§1.4,
§9.2, header).** The previous draft said it "does NOT amend
or depend on the kernel specification" but then referenced
"Kernel Spec §10.2" in §9.2. Resolved by: stating explicitly
that the spec depends on the existing replay model defined
in the kernel specification and compound concurrency
specification, while requiring no kernel semantic changes.
The header `Depends on` line now includes the kernel
specification with the qualifier "(replay model only; no
kernel changes required)". §9.2 now cites both the kernel
specification and the compound concurrency specification
with precise section references.

**Fix 2 — System Specification amendment language (§1.4,
§6.1, header).** The previous draft said it "amends the
system specification by adding stream.subscribe and
stream.next to the external effect catalog (§7.1)." The
base system spec does not own a closed built-in external
effect catalog. Resolved by: stating that this spec defines
two reserved external effect IDs that use the existing
generic external evaluation path. The `Amends` header no
longer mentions the system specification. A new `Extends`
header line references the spawn specification's capability-
value pattern. §6.1 now frames the capability-value
extension as applying an existing pattern rather than
amending the value model.

**Fix 3 — Cursor-recovery alternative wording (§3.2).** The
previous draft said cursor is "durably recoverable via the
activity result in the journal." Resolved by: stating that
cursor is ordinary workflow state reconstructed from prior
journaled effect results via normal replay, and that exact
behavior depends on the retrieval effect's own contract. No
special cursor durability mechanism implied.

**Fix 4 — Nested-loop wording (§3.3 NG8, §15 OQ1).** The
previous draft described nested `for yield* each` as
"concurrent subscriptions within one coroutine," but §15
described the inner loop as running to completion before the
outer loop advances (sequential, not concurrent). Resolved
by: stating in both NG8 and OQ1 that execution is
sequential, and that the deferral is because the replay
matching algorithm has not been validated for interleaved
`stream.next` entries from two subscriptions within one
coroutineId.

**Fix 5 — Capability capture into spawned bodies (§6.3).**
The restriction table allowed "Pass to spawned body via
lexical capture — Yes" without justification. Resolved by:
adding a justification paragraph explaining that the spawned
child executes within its parent's Effection scope and
cannot outlive the subscription, paralleling the existing
spawn specification's rule for parent-scope bindings
(SP11(A)).
