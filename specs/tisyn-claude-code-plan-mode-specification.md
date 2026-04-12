# Tisyn Claude Code Plan Mode Specification

**Version:** 0.2.3
**Implements:** Tisyn System Specification 1.0.0
**Amends:** Tisyn Kernel Specification 1.0.0, Tisyn Compiler
Specification 1.2.0
**Depends on:** Tisyn Resource Specification 0.1.0, Tisyn
Blocking Scope Specification 0.1.0, Tisyn Spawn Specification
0.1.0, Tisyn LLM Sampling Specification 1.0.0 (coexists —
does not replace)
**Status:** Draft

---

### Implementation Status Note

Reviewed against the implementation currently present on
this branch on 2026-04-12. The checked-in code provides the
low-level `claude-code` ACP/SDK transport bindings and
tests for `newSession`, `plan`, `fork`, `openFork`, and
progress delivery. It does not yet provide the authored
`ClaudeCode().open(...)` capability surface, execution
handle supervision via `supervise(...)`, compiler lowering,
or the replay and slot-management behavior specified here.

---

### Changelog

**v0.2.3** — Initial implementation-ready release.

Defines the Claude Code Plan Mode integration surface for
Tisyn workflows: session-scoped capability over a configured
ACP stdio transport; single-slot sequential execution model;
execution handle with direct join and supervised consumption;
fork as an effectful resource-creating operation using the
committed-conversational-state snapshot rule; Case A / Case B
replay semantics; three-layer teardown separation (session,
execution, transport); and the normative observable semantics
boundary (§1.3a).

---

## 1. Overview

This specification defines the Claude Code Plan Mode
integration surface for authored Tisyn workflows. It
introduces three new constructs:

1. A **session-scoped Claude Code capability** returned by
   `ClaudeCode().open(...)`, backed by a session resource
   whose lifetime is scope-bound. The session is acquired
   over a configured ACP stdio transport; the transport and
   its underlying process are not owned by the session. A
   session holds at most one in-flight plan execution at a
   time.

2. An **execution handle** returned by `cc.plan(...)`, a
   new restricted capability type that represents one
   in-flight plan execution. The handle supports direct
   join for the final result or supervised consumption for
   event observation with final result delivery.

3. A **session fork** via `cc.fork()`, an effectful
   session-topology operation that creates a logically
   independent child session for exploratory branching.
   Fork may fail; the parent session remains valid on
   failure.

The target authored surface is:

````typescript
const cc = yield* ClaudeCode().open({
  cwd: "/project",
  systemPrompt: "Plan refactoring tasks",
});

// Plan and supervise (session holds one execution at a time)
const planned = yield* cc.plan({
  prompt: "Refactor the auth module for testability",
});
const result = yield* supervise(planned, function* (event) {
  console.log(event.type, event.data);
  if (isWrongTurn(event)) {
    throw new Error("wrong turn");
  }
});

// Second plan on same session: only after first completes
const planned2 = yield* cc.plan({ prompt: "Summarize the changes" });
const value = yield* planned2;

// Fork for exploration
const branch = yield* cc.fork();
const branchPlanned = yield* branch.plan({ prompt: "Try approach B" });
const branchResult = yield* branchPlanned;
````

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- the session-scoped Claude Code capability and its
  resource-backed lifecycle
- the single-execution-slot model: a session holds at most
  one in-flight plan execution at a time
- the execution-handle restricted capability type
- direct join semantics for execution handles
- supervised consumption semantics via `supervise(...)`
- single-consumer ownership rules and enforcement model
- session linearity rules (sequential execution, concurrent
  rejection, post-close errors)
- event delivery contract
- session fork semantics and fork fallibility
- replay and durability rules: Case B (stored result) and
  Case A (new forward submission at live frontier)
- teardown semantics decomposed by layer
- conformance test requirements

### 1.3 What This Specification Does Not Cover

The following are explicitly outside this specification's
scope.

- `accept()` operation semantics (§15.1)
- Durable event streaming (§15.2)
- Merge/promote for forked sessions (§15.3)
- Cross-branch communication (§15.4)
- Multi-model selection or routing (§15.6)
- Generic ACP abstraction beyond what is needed for this
  integration (§15.7)
- Transport lifecycle management — starting or stopping the
  configured transport process from workflow code (§15.10)

The following are **explicitly adapter-internal** and NOT
normative in this specification:

- ACP protocol message shapes and field names
- stdio framing details
- Session ID format, assignment, or reuse strategy
- Process ID or OS process management
- Transport connection reuse strategy between sessions
- Session negotiation or handshake protocol details

Only observable semantics are normative. See §1.3a for the
complete boundary definition.

### 1.3a Observable Semantics Boundary

OB1. The normative observable contract of this
     specification consists of exactly the following
     properties. A conforming implementation MUST satisfy
     each of these; test assertions MUST be expressed
     exclusively in terms of these properties:

     (a) **Capability shape.** The set of methods present
         on values returned by `open()` and `fork()`:
         `plan` and `fork` on `ClaudeCodeCC`; `plan` only
         on `ClaudeCodeBranch`.

     (b) **Returned values.** The final result values
         returned by `yield* planned` and by
         `yield* supervise(planned, handler)`, including
         error values when the execution fails.

     (c) **Event delivery behavior.** The sequence of
         events delivered to the `supervise` handler:
         their `type` and `data` fields, their order, and
         the buffering guarantee (ED1–ED3).

     (d) **Error propagation.** Which operations throw,
         the category of error thrown, and whether the
         error is catchable at a specific call site. Error
         message wording is NOT normative; error category
         is.

     (e) **Journal contents.** The presence or absence of
         YieldEvents and CloseEvents under specific
         coroutineIds, and the result values carried in
         CloseEvents.

     (f) **Session isolation properties.** The isolation
         invariants between parent and forked sessions
         (FK4–FK5) and between sibling forks (FK6).

     (g) **Capability liveness.** Whether a session or
         branch capability is usable (accepts further
         `plan()` or `fork()` calls) or invalid (rejects
         them with a descriptive error) at a given point
         in the workflow's execution.

OB2. The following properties are explicitly NOT part of
     the normative observable contract. Conforming
     implementations are free to vary these; tests MUST
     NOT assert on them:

     (a) Session identifiers of any kind (adapter-internal
         session IDs, connection handles, slot tokens).
     (b) OS process identifiers.
     (c) Whether the same transport connection object is
         reused across sessions or forks.
     (d) ACP protocol message shapes, field names, or
         framing details.
     (e) The number or content of adapter-internal
         messages exchanged for any given operation.
     (f) The internal representation of committed
         conversational state (history encoding, context
         window format, embedding values).
     (g) The specific events produced by a Case A
         (live-frontier) replay; these MAY differ from
         the interrupted prior execution in any respect.

### 1.4 Relationship to LLM Sampling Specification

This specification coexists with the LLM Sampling
Specification. `llm.sample` remains the generic one-shot
sampling abstraction. Workflows MAY use both in the same
program; they are independent and do not interact.

### 1.5 Key Design Decisions

- The session-scoped capability merges session and agent
  facade. Resource lifetime and replay reconstruction apply
  underneath.
- **A session holds at most one in-flight plan execution
  at a time (Model A).** This is a semantic restriction on
  the session, not a type restriction on the capability.
  The runtime enforces it. Attempting to dispatch a second
  `plan()` before the first execution completes MUST be
  rejected.
- Multiple sequential plan executions on the same session
  are permitted; each runs to completion before the next
  may be dispatched.
- The execution handle is a new restricted capability type
  borrowing from spawn task handles and stream subscriptions
  but is not an instance of either.
- `supervise(...)` is a distinct authored form.
- Events are buffered from execution start until supervision
  begins.
- `fork()` is an effectful operation that creates a child
  session resource. It MAY fail; failure surfaces as a
  workflow error at the `yield* cc.fork()` site. The parent
  session remains valid on fork failure.
- Opening a new session does not create a new OS process.
- Replay Case A (live frontier) submits a new plan request
  from scratch. It does not reproduce or replay the
  interrupted prior attempt in any sense. Only the new
  result becomes durable.

---

## 2. Terminology

**ACP stdio transport.** The configured communication
channel through which Tisyn communicates with Claude Code,
operating in ACP stdio mode. Its underlying OS process is
managed by transport/runtime configuration, not by `open()`.
The internal structure of ACP messages, framing, and any
session identifiers is adapter-internal and not normative.

**Configured transport process.** The OS-level Claude Code
process backing the ACP stdio transport. Its lifecycle is
managed by the transport layer. A single configured transport
process MAY serve multiple sessions. Terminating this process
is never triggered by session teardown.

**Session.** A logical, stateful conversation context
established over the configured ACP stdio transport. A
session has a conversational state (history, context window)
distinct from the transport's process state. A session holds
at most one in-flight plan execution at a time.

**Session slot.** The exclusive execution slot that a session
exposes. At any moment, the slot is either vacant (available
for a new `plan()` call) or occupied (an execution is in
flight). `plan()` MUST be rejected if the slot is occupied
(SL5). The slot becomes vacant only after execution close
is complete — specifically, after the child CloseEvent is
durably journaled (TD5(a)). The slot is NOT vacated by
the execution completing at the backend, by the event
stream closing, or by any intermediate step of execution
close; it is vacated when the entire execution-close
sequence reaches TD5(a). The session slot governs `plan()`
dispatch only; `fork()` is not subject to the slot
constraint (SL6).

**Committed conversational state.** The portion of a
session's conversation history that is durably recorded.
A plan interaction becomes part of the committed
conversational state only after its CloseEvent is journaled
(TD5(a)). An in-flight execution's effects — events,
partial results, pending context updates — are NOT part of
the committed conversational state. `fork()` snapshots the
committed conversational state at the time of the call;
any in-flight execution's uncommitted effects are excluded
from the fork's initial state.

**Session resource.** The Tisyn resource that holds the
session handle and enforces session lifetime. Created during
`open()`, torn down when the enclosing scope exits. Teardown
releases the session; it does NOT terminate the configured
transport process.

**Session-scoped capability.** The value returned by
`ClaudeCode().open(...)`. Exposes `plan(...)` and `fork()`
methods. Backed by the session resource; valid only while
the session resource is alive.

**Execution handle.** A restricted capability value
representing one in-flight plan execution. Supports exactly
one terminal consumer: direct join or supervised consumption.

**Direct join.** `yield* planned` — the parent suspends
until the plan execution completes, then resumes with the
final result. Events are not observed.

**Supervised consumption.** `yield* supervise(planned,
handler)` — the parent processes events via a structured
per-event generator operation, then receives the final
result. If the handler fails, the execution is cancelled.

**Handler operation.** The generator function passed to
`supervise(...)`. Executes as ordinary workflow work; MAY
perform `yield*` effects.

**Plan execution.** The background task occupying a
session's slot, spawned by `cc.plan(...)`. Communicates
with the Claude Code backend over the session's transport
channel, produces events, and completes with a final result.

**Session fork.** `cc.fork()` — an effectful operation that
creates a child session resource derived from the parent's
current conversational state. MAY fail during initialization.
Does NOT create a new OS process. Transport-level isolation
mechanism is adapter-internal.

**Event.** An ephemeral, non-durable observation of
in-flight plan execution activity. Not journaled, not
replayed.

**Final result.** The durable completion value of a plan
execution. Journaled and replayed normally.

**Session close.** Releasing the session when the session
resource's scope exits (TD1–TD3). Does NOT terminate the
configured transport process.

**Execution close.** Resolution of a plan execution by
completion, error, or cancellation (TD4–TD6). Does NOT
close the session. Vacates the session slot.

**Transport shutdown.** Termination of the configured
transport process (TD7–TD9). Adapter-internal; never
triggered by any session or execution lifecycle event.

**Case B replay.** Replay of a plan execution whose
CloseEvent is present in the journal. The stored result is
returned directly; no plan request is submitted.

**Case A replay.** Replay of a plan execution whose
CloseEvent is NOT yet in the journal (live frontier). The
interrupted prior attempt is abandoned. A new live plan
request is submitted from scratch. The result of the new
request becomes the new durable result.

---

## 3. Session-Scoped Capability

### 3.1 Public API

````typescript
declare function ClaudeCode(): {
  open(input?: ClaudeCodeOpenInput): Workflow<ClaudeCodeCC>;
};

interface ClaudeCodeCC {
  plan(input: ClaudePlanInput): Workflow<ClaudePlanned>;
  fork(): Workflow<ClaudeCodeBranch>;
}

interface ClaudeCodeBranch {
  plan(input: ClaudePlanInput): Workflow<ClaudePlanned>;
}
````

### 3.1a Normative Lifecycle Ownership Table

| Layer | Owns | Created by | Terminated by |
|-------|------|-----------|--------------|
| Transport (ACP stdio) | OS process; connection channel | Deployment / runtime config | Transport shutdown (adapter-internal; never by session lifecycle) |
| Session | Conversational state; session handle; session slot | `open()` | Scope exit (session close, TD1–TD3) |
| Execution | Plan run state; event buffer; session slot occupancy | `cc.plan(...)` | Completion, error, handler failure, or scope exit (execution close, TD4–TD6) |
| Fork | Derived session; isolated conversation state; own session slot | `cc.fork()` | Fork scope exit (session close for child, TD1–TD3) |

LO1. The transport layer MUST NOT be terminated by any
     session lifecycle event (open, close, fork, plan).

LO2. The session layer MUST NOT be terminated by any
     execution lifecycle event (plan dispatch, execution
     completion, execution cancellation).

LO3. The execution layer MUST be terminated when:
     (a) the plan execution completes with a result,
     (b) the plan execution fails with an error,
     (c) the supervise handler fails and cancels the
         execution, or
     (d) the enclosing scope exits before the execution
         completes.

LO4. The fork layer follows the same lifecycle rules as
     the session layer. Fork teardown MUST NOT terminate
     the parent session or the transport.

### 3.2 `ClaudeCode().open(...)`

CC1. `ClaudeCode().open(input?)` MUST acquire or create a
     session over the configured ACP stdio transport and
     return a session-scoped capability value. This
     operation MUST NOT start a new OS process.

CC2. The returned value MUST be backed by a session
     resource. The session resource holds the session handle
     and manages the session slot. The resource's lifetime
     is bounded by the scope in which `open()` is called.

CC3. When the enclosing scope exits — whether by normal
     completion, error, or cancellation — the session
     resource MUST be torn down per TD1–TD3.

CC4. The session-scoped capability MUST remain valid only
     while its backing session resource is alive. Using the
     capability after the resource is torn down is undefined
     behavior; the runtime SHOULD reject such use with a
     descriptive error.

CC5. On replay, the runtime MUST reconstruct a semantically
     equivalent session-scoped capability at the same
     program point per RP1–RP6. The session's conversational
     state is rebuilt from the replayed execution history.
     The session's internal state is NOT independently
     persisted as a mutable snapshot.

### 3.3 Session-Scoped Capability as Value

CC6. The session-scoped capability is a restricted
     capability value. It MUST NOT be:
     - passed as an argument to an agent method
     - returned from a workflow
     - stored in an object or array
     - included in a journal event result value

CC7. The session-scoped capability MAY be bound to a local
     `const` variable and referenced by name within the
     scope where it was created.

CC8. The session-scoped capability MAY be passed to
     `fork()` on itself (i.e., `cc.fork()` is a method
     call on the capability).

CC8a. `ClaudeCodeBranch` follows the same restricted-
      capability rules as `ClaudeCodeCC` (CC6–CC7). The
      only distinction is that `ClaudeCodeBranch` does not
      expose `fork()` (FK3).

### 3.4 Configuration Input

CC9. `ClaudeCodeOpenInput` MUST support at minimum:

     - `cwd` (optional string): working directory
     - `systemPrompt` (optional string): system prompt
     - `model` (optional string): model identifier

     Additional fields are implementation-defined.

### 3.5 Authored Form

CC10. `yield* ClaudeCode().open(...)` is a resource-
      creating operation. The implementation MUST ensure
      the returned capability is backed by a session
      resource with the lifetime semantics in CC2–CC5.
      The exact compiler lowering strategy is
      implementation-defined.

CC11. The compiler MUST NOT require a separate
      `useClaudeCodeAgent(session)` call.

### 3.6 Session Linearity Rules (Single-Slot Model)

SL1. A session holds at most one in-flight plan execution
     at a time. This is the single-slot model (Model A).
     The session slot is occupied from the point `plan()`
     dispatches the background execution task (PL2). The
     slot becomes vacant only after execution close is
     complete — specifically, only after the child
     CloseEvent is durably journaled (TD5(a)). The slot
     does NOT become vacant upon backend completion, event
     stream closure, or any earlier step; it becomes vacant
     at the end of the full execution-close sequence.

SL2. Multiple `plan()` calls MAY be issued on the same
     session provided they are issued sequentially — i.e.,
     each call is made only after the previous execution
     has fully closed (slot is vacant, TD5(a) complete).
     Each `plan()` call produces a new execution handle.
     Prior execution handles are unaffected by subsequent
     `plan()` calls.

SL3. Calling `plan()` on a session capability after the
     session resource has been torn down MUST produce a
     descriptive error indicating the session is closed.

SL4. Calling `fork()` on a session capability after the
     session resource has been torn down MUST produce a
     descriptive error indicating the session is closed.

SL5. Calling `plan()` while the session slot is already
     occupied (a prior plan execution has been dispatched
     and has not yet fully closed) MUST be rejected
     immediately, before any background task is spawned or
     any adapter call is made. The error MUST be
     descriptive and MUST indicate that the session already
     has an in-flight execution. The prior in-flight
     execution MUST NOT be affected by the rejected call.

     > Rationale: Claude Code sessions maintain sequential
     > conversational context. Concurrent dispatch would
     > produce ambiguous interleaving of context updates.
     > The slot check is a runtime guard, not a type
     > restriction. The compiler does not prevent two
     > sequential `plan()` calls from looking concurrent
     > at runtime (e.g. within a `spawn`).

SL6. The session slot governs `plan()` dispatch only.
     `fork()` is a session-derivation operation and is NOT
     subject to the session slot constraint. A `fork()`
     call MAY be issued while the session slot is vacant
     or occupied. When the slot is occupied, `fork()`
     snapshots only the committed conversational state of
     the parent (see §2, FK2a). This is a deliberate
     design choice: forking captures a consistent, durable
     snapshot of the session's history without needing to
     wait for or include the in-flight execution's
     uncommitted effects.

---

## 4. Execution Handle

### 4.1 What It Is

EH1. `cc.plan(input)` MUST, if the session slot is vacant,
     occupy the slot and return an execution handle — a
     restricted capability value representing the in-flight
     plan execution.

EH2. The execution handle is a new restricted capability
     type, distinct from spawn task handles and stream
     subscription handles.

EH3. The execution handle MUST be represented as:

     ```
     { __tisyn_execution: string }
     ```

     where the string token is deterministically derived
     from the execution's identity (see §4.3).

### 4.2 Restriction Table

EH4. The execution handle MUST follow these restriction
     rules:

     | Use | Permitted? | Enforced by |
     |-----|-----------|-------------|
     | Bind via `const` declaration | Yes | — |
     | Reference via variable name | Yes | — |
     | Pass to `yield* handle` (join) | Yes | Compiler + Runtime |
     | Pass to `supervise(handle, handler)` | Yes | Compiler + Runtime |
     | Pass as argument to agent method | No | Compiler |
     | Return from workflow | No | Compiler |
     | Store in object or array | No | Compiler |
     | Reassign (`let`) | No | Compiler |
     | Pass to spawned child via closure | No | Compiler |
     | Use more than once | No | Compiler + Runtime |
     | Cross agent boundary | No | Runtime |
     | Include in journal result value | No | Runtime |
     | Survive replay as plain value | No | Reconstructed |

### 4.3 Identity Allocation

EH5. The execution handle's token MUST be deterministic so
     that replay can reconstruct a semantically equivalent
     handle at the same program point.

EH6. The identity allocation rule is independent of the
     spawn specification.

EH7. The token MUST incorporate:
     - the parent coroutineId
     - a monotonic counter within the parent's scope

     The exact format is implementation-defined but MUST be
     deterministic given the same program and journal.

### 4.4 Replay Reconstruction

EH8. On replay, the runtime MUST reconstruct a semantically
     equivalent execution handle at the same program point.
     The reconstructed handle MUST refer to the same child
     coroutineId whose journal entries are being replayed.

EH9. The execution handle's exact reconstruction rule MUST
     be validated independently of the spawn specification.

EH10. The runtime MUST maintain a consumed/not-consumed flag
      per handle for backstop enforcement of the
      single-consumer rule during replay.

---

## 5. Single-Consumer Ownership

### 5.1 The Rule

SC1. An execution handle MUST be consumed by exactly one
     terminal consumer. Either:

     (a) `yield* handle` — direct join, or
     (b) `yield* supervise(handle, handler)` — supervised
         consumption

     Not both. Not twice. Not two concurrent consumers.

SC2. The compiler SHOULD enforce this rule statically where
     possible.

SC3. The runtime MUST reject invalid second consumption.
     Error: "execution handle already consumed."

SC4. If a handle is bound but never consumed, the execution
     still runs and its result is journaled. The compiler
     SHOULD warn.

### 5.2 Exhaustiveness

SC5. If the handle is consumed in one branch of an `if`,
     it MUST be consumed in the other branch too. The
     compiler SHOULD enforce this statically.

SC6. The runtime MUST maintain a consumed/not-consumed flag
     per handle. Any subsequent consumption attempt MUST be
     rejected.

---

## 6. Direct Join

### 6.1 Semantics

````typescript
const result = yield* planned;
````

DJ1. `yield* handle` MUST suspend the parent until the plan
     execution completes.

DJ2. When the execution produces a final result, the parent
     MUST resume with that value.

DJ3. If the execution fails, the error MUST propagate to
     the parent. It MAY be caught via `try/catch`.

DJ4. Events produced during execution MUST NOT be observed
     in the direct-join path. They are lost.

DJ5. The join does not start the execution. The execution
     was spawned at `cc.plan(...)` and is already running.

DJ6. Direct join consumes the handle (SC1).

### 6.2 Completion Before Join

DJ7. If the execution completed before the parent reaches
     `yield* planned`, the join MUST return immediately
     with the stored result.

### 6.3 Error Propagation

DJ8. If the execution fails:

     (a) The child task throws.
     (b) The child's CloseEvent is written with
         `status: "err"`.
     (c) The join propagates the error to the parent.

---

## 7. Supervised Consumption

### 7.1 Authored Form

````typescript
const result = yield* supervise(planned, function* (event) {
  console.log(event.type, event.data);
  if (isWrongTurn(event)) {
    throw new Error("wrong turn");
  }
});
````

### 7.2 Handler Operation

SV1. The second argument to `supervise(...)` MUST be a
     generator function — a structured per-event workflow
     operation, not a free-floating callback.

SV2. The handler MUST execute as ordinary workflow work
     inside the supervision loop. It MAY perform `yield*`
     effects.

SV3. If the handler fails, the supervision scope tears
     down, which cancels the underlying execution (§7.4).

### 7.3 Supervision Lifecycle

SV4. `supervise(handle, handler)` MUST subscribe to the
     execution handle's event stream and begin processing
     events.

SV5. For each event, the handler MUST be invoked with the
     event value. The handler runs in the foreground: the
     next event MUST NOT be delivered until the current
     handler invocation completes. This provides natural
     backpressure.

SV6. Events MUST be delivered in the order produced. No
     reordering.

SV7. When the execution completes, `supervise` MUST return
     the execution's final result.

SV8. `supervise` consumes the handle (SC1).

### 7.4 Cancellation Coupling

SV9. If the handler operation fails:

     (a) `supervise` catches the error.
     (b) `supervise` cancels the execution's background
         task via structured concurrency teardown.
     (c) Execution close (TD4–TD6) runs: the event stream
         closes; no further events are delivered.
     (d) The Claude Code plan operation is aborted over the
         transport channel. This is an execution-level
         abort. It MUST NOT close the session. It MUST NOT
         terminate the configured transport process. It
         MUST NOT send a second abort signal if execution
         close has already signalled the adapter.
     (e) The session slot is vacated on execution close.
     (f) `supervise` re-throws the error to the caller.

### 7.5 Execution Failure During Supervision

SV10. If the execution fails while supervision is active,
      the error MUST propagate to the `supervise` caller.
      The handler is not invoked for the error.

### 7.6 No Events Produced

SV11. If the execution completes without emitting any
      events, `supervise` MUST return the final result
      immediately. The handler is never invoked.

### 7.7 `supervise` Is Not Stream Iteration

SV12. `supervise(...)` is a distinct authored form specific
      to execution handles.

      | Property | `each(stream)` | `supervise(handle, handler)` |
      |----------|---------------|------------------------------|
      | Source | Any Effection Stream | Execution handle only |
      | Returns | void | Final result (R) |
      | On handler failure | Loop exits, scope teardown | Execution cancelled, error propagates |
      | Multiple consumers | Multiple subscriptions | Single consumer only |

SV13. If the compiler does not recognize `supervise(...)`,
      the runtime MUST enforce single-consumer semantics.

---

## 8. Event Delivery Contract

### 8.1 Buffering Policy

ED1. Events MUST be buffered from execution start. Events
     produced between handle creation and `supervise`
     invocation MUST be retained.

ED2. When `supervise` subscribes, it MUST receive all
     buffered events in order, followed by any events
     produced during supervision.

ED3. All events from execution start are available to the
     first `supervise` call, regardless of delay between
     `cc.plan(...)` and `supervise(...)`.

### 8.2 Justification

Buffered-from-start is the v1 default. For v1, Claude Code
plan executions produce bounded event volumes per operation.

### 8.3 Direct Join

ED4. In the direct-join path, the buffer is allocated but
     never drained. It is discarded on execution close.

### 8.4 Future Policy

ED5. A future specification MAY introduce bounded buffers
     or drop policies.

---

## 9. Event Taxonomy

### 9.1 Event Envelope

EV1. Each event MUST have at least a `type` field (string)
     and a `data` field (any serializable value).

     ```typescript
     interface ExecutionEvent {
       type: string;
       data: unknown;
     }
     ```

EV2. The type set is open. The runtime MUST deliver events
     with unrecognized type strings to the handler opaquely,
     without raising a runtime error. Authored handlers MAY
     choose how to handle unknown types.

EV3. Events MUST be delivered in the order produced.

### 9.1.1 Example Event Types (Non-Normative)

| Type | Description | Typical data |
|------|-------------|-------------|
| `"text"` | Partial text output | `{ content: string }` |
| `"thinking"` | Reasoning content | `{ content: string }` |
| `"tool_start"` | Tool invocation begins | `{ toolName: string, input: unknown }` |
| `"tool_end"` | Tool invocation completes | `{ toolName: string, status: string, result: unknown }` |
| `"status"` | Status change | `{ message: string }` |

### 9.2 Non-Durability

EV4. Events MUST NOT be written to the journal.

EV5. Events MUST NOT be replayed during crash recovery.

EV6. Events are non-durable:

     (a) NOT preserved across crash and recovery.
     (b) NOT delivered if the handle is never supervised.
     (c) In Case A replay, the new live submission MAY
         produce different events than the interrupted
         prior attempt. The prior attempt's events are
         permanently lost and MUST NOT be reproduced.

EV7. The same invariants governing Progress in the Sampling
     Spec (PG1–PG7) apply to execution-handle events.

### 9.3 Adapter Translation

EV8. The adapter MUST translate provider-native partial
     output into events conforming to §9.1. The translation
     is adapter-internal.

EV9. The `type` strings and `data` shapes are adapter-
     defined. The runtime delivers events to the handler
     opaquely.

---

## 10. Plan Operation

### 10.1 Semantics

PL1. `cc.plan(input)` MUST first check the session slot
     (SL5). If the slot is occupied, the call MUST be
     rejected immediately with a descriptive error before
     spawning any background task or contacting the adapter.

PL2. If the slot is vacant, `cc.plan(input)` MUST occupy
     the slot and spawn a background execution task. The
     parent continues immediately with the execution handle.

PL3. The background execution task MUST:
     (a) Send the plan request to the backend over the
         session's transport channel.
     (b) Receive streaming events and buffer them.
     (c) Receive the final result when the backend
         completes.
     (d) Complete execution close (TD4–TD6). The session
         slot becomes vacant at TD5(a) — when the child
         CloseEvent is durably journaled. Vacancy occurs
         at that step and not before. After the slot is
         vacant, the session accepts the next `plan()`
         call.

PL4. The background execution task is a child of the scope
     that contains `cc.plan(...)`. If the scope exits before
     the execution completes, the execution is cancelled per
     TD4–TD6. Execution cancellation follows the same TD5
     sequence: the CloseEvent with `status: "cancelled"` is
     journaled at TD5(a), after which the session slot is
     vacated. Execution cancellation MUST NOT close the
     session resource. Execution cancellation MUST NOT
     terminate the configured transport process.

### 10.2 Plan Input

PL5. `ClaudePlanInput` MUST support at minimum:

     - `prompt` (string): the planning instruction

     Additional fields are implementation-defined.

### 10.3 Plan Result

PL6. The plan's final result is the completion value from
     the Claude Code backend.

PL7. The final result type is implementation-defined for v1.

### 10.4 Journaling

PL8. The plan dispatch MUST produce a child coroutineId for
     the background execution task.

PL9. The background execution task's completion MUST be
     journaled under its coroutineId as the child's
     CloseEvent:

     ```
     Close(coroutineId: "<parent>.<N>",
           result: { status: "ok", value: <plan result> })
     ```

PL10. Events produced during execution MUST NOT be
      journaled. Only the final result is durable.

---

## 11. Session Fork

### 11.1 What Fork Is

FK1. `cc.fork()` is a session-derivation operation, not an
     ordinary plan dispatch. As specified in SL6, `fork()`
     is NOT governed by the session slot constraint.
     `fork()` MAY be called while the session slot is
     vacant or occupied.

FK2. `cc.fork()` is an **effectful operation that MAY
     fail** during child session initialization. It follows
     standard resource initialization failure semantics
     (Resource Spec §1.2): if the child session resource
     fails to initialize, the error surfaces as a workflow
     error at `yield* cc.fork()`. The following sub-clauses
     apply:

FK2a. **Committed-state snapshot rule.** The child session
      MUST be initialized from the parent's committed
      conversational state at the time of the `fork()`
      call. The committed conversational state is the
      sequence of plan interactions whose CloseEvents are
      durably journaled as of the `fork()` call (see §2).
      If the parent session slot is occupied at the time
      of the `fork()` call, the in-flight execution's
      effects are NOT yet committed; they MUST NOT be
      included in the fork's initial state. The fork sees
      only the durably recorded history.

FK2b. `cc.fork()` MUST NOT mutate the parent session's
      conversational state. The parent's context window
      and conversation history MUST be identical before
      and after a `fork()` call, regardless of whether
      `fork()` succeeds or fails.

FK2c. `cc.fork()` MAY reuse the underlying transport
      connection. This is adapter-internal and NOT
      observable. The fork MUST NOT create a new OS
      process.

FK2d. If `cc.fork()` fails:
      (i)   The error MUST propagate to the caller as an
            ordinary workflow error at `yield* cc.fork()`.
      (ii)  The parent session MUST remain open and valid.
      (iii) The parent session slot is NOT affected: if
            occupied before the fork attempt, it remains
            occupied; if vacant, it remains vacant.
      (iv)  No child session resource is created.
      (v)   The parent's committed conversational state
            MUST be unchanged. A failed `fork()` MUST NOT
            modify the parent's conversation history,
            context window, or any other aspect of the
            parent session's state.
      (vi)  A failed `fork()` MUST NOT affect the
            validity or outcome of future `plan()` or
            `fork()` calls on the parent session. The
            parent session MUST accept subsequent `plan()`
            calls (if the slot is vacant) and subsequent
            `fork()` calls exactly as if the failed fork
            had never been attempted.

FK2e. The identity of a forked session — including any
      adapter-internal session identifiers — is NOT an
      observable property. Tests MUST NOT assert on session
      IDs, connection handles, or process IDs. The
      observable fork properties are: (a) the returned
      `ClaudeCodeBranch` has a `plan()` method but not
      `fork()`, and (b) plan isolation invariants hold
      (FK4–FK5).

FK3. `cc.fork()` MUST return a new `ClaudeCodeBranch` — a
     session-scoped capability backed by a child session
     resource with its own session slot. The branch
     capability exposes `plan()` but does NOT expose
     `fork()`. Recursive forking is deferred (FD4).

### 11.2 Isolation

FK4. The child session MUST be isolated from the parent.
     Subsequent `plan()` calls on the child MUST NOT
     mutate the parent session's state.

FK5. Operations on the parent MUST NOT mutate the child's
     state. The parent's conversation history MUST NOT
     include the child's planning activity.

FK6. Multiple forks from the same parent session MUST be
     permitted. Each fork MUST be independent.

### 11.3 Lifetime

FK7. The child session resource has a lifetime bounded by
     the scope in which `fork()` is called.

FK8. The child session MUST NOT outlive the parent
     session's scope. If the parent scope exits, the
     child's scope is torn down first.

FK9. Branch teardown is a session close for the child
     session (TD1–TD3). No merge or promotion occurs
     automatically. Branch teardown MUST NOT terminate
     the configured transport process or affect the
     parent session handle.

### 11.4 Usage

FK10. The caller MAY call `plan(...)` on a
      `ClaudeCodeBranch`. The caller MUST NOT call `fork()`
      on a branch — recursive forking is deferred (FD4).

````typescript
// fork() is effectful and may fail
const branch = yield* cc.fork(); // propagates error on failure

const planned = yield* branch.plan({
  prompt: "Try a different approach",
});
const result = yield* planned;
// branch session close occurs at scope exit.
// Parent session and transport process are unaffected.
````

### 11.5 Replay

FK11. The fork operation MUST produce a child coroutineId
      for the child session resource.

FK12. On replay, the fork's initialization effects MUST be
      replayed under the fork's child coroutineId per
      RP1–RP6.

FK13. The branch session's internal state is NOT
      independently journaled as a mutable snapshot. It is
      rebuilt from the replayed execution history for that
      branch.

### 11.6 Deferred Fork Extensions

FD1. **No merge.** Branch results do not automatically
     flow back into the parent session.

FD2. **No promote.**

FD3. **No cross-branch communication.**

FD4. **Branch-of-branch deferred.** `ClaudeCodeBranch`
     does not expose `fork()`.

---

## 12. Session Topology

### 12.1 Tree Structure

ST1. A session owns exactly one slot. The slot is either
     vacant or occupied by the current execution. A fork
     creates a child session with its own independent slot.
     The resource tree is:

     ```
     Configured ACP stdio transport (transport-owned)
     └── Session handle (session resource, one slot)
         │   [slot: vacant | occupied by current execution]
         │   [committed state: CloseEvents journaled so far]
         │
         ├── [Current execution handle — if slot occupied]
         │   (slot vacates only after CloseEvent journaled, TD5(a))
         │
         ├── Branch X (child session resource, own slot)
         │   [init from parent committed state at fork time]
         │   └── [Branch X current execution handle]
         │
         └── Branch Y (child session resource, own slot)
             [init from parent committed state at fork time]
             └── [Branch Y current execution handle]
     ```

     Each session slot is independent. `fork()` captures
     only the parent's committed conversational state
     (FK2a, SL6). If the parent slot is occupied at fork
     time, the in-flight execution's effects are excluded
     from the fork's initial state — they are not yet
     committed.

ST2. Lifetimes are strictly nested — children MUST NOT
     outlive parents. The configured transport is outside
     this tree and has a lifecycle independent of any
     session.

ST3. This is standard Tisyn structured concurrency applied
     to session topology. No new lifetime machinery is
     introduced.

---

## 13. Replay and Durability

### 13.1 What Is Durable

RD1. The following MUST be journaled:

     | Artifact | Journaled? | Mechanism |
     |----------|-----------|-----------|
     | Session creation (init effects) | Yes | Resource child YieldEvents |
     | Plan dispatch | Yes | Child YieldEvents under execution coroutineId |
     | Plan's final result | Yes | Child CloseEvent |
     | Fork creation (init effects) | Yes | Resource child YieldEvents |
     | Fork initialization failure | Yes | Child CloseEvent with `status: "err"` |

RD2. The following MUST NOT be journaled:

     | Artifact | Journaled? | Reason |
     |----------|-----------|--------|
     | Execution events | No | Observational only |
     | Session internal state | No | Reconstructed by replay |
     | Execution handle value | No | Reconstructed at program point |
     | Branch internal state | No | Reconstructed by replay |
     | Transport process state | No | Transport-owned |
     | Session IDs or connection IDs | No | Adapter-internal; not observable |
     | Prior interrupted execution's events (Case A) | No | Permanently lost; new submission is independent |

### 13.2 No New Persistence Surface

RD3. This specification MUST NOT introduce new durable
     event kinds beyond YieldEvent and CloseEvent.

RD4. This specification MUST NOT introduce new persistence
     machinery beyond the existing journal.

### 13.3 Two-Case Replay Contract

RD5. The replay contract for plan executions:

     **Case B — Final result already journaled.**
     The plan execution's CloseEvent is present in the
     journal. Replay MUST return the stored final result
     directly. Replay MUST NOT contact the adapter. Replay
     MUST NOT re-execute Claude planning. Replay MUST NOT
     regenerate or deliver events. The stored result is
     authoritative and immutable.

     **Case A — Final result NOT journaled (live frontier).**
     The plan execution's CloseEvent is absent from the
     journal. The prior interrupted attempt is abandoned
     entirely — it produced no durable artifact. Replay
     MUST submit a new, independent plan request over the
     transport. This new submission:
     - is NOT required to preserve any property of the
       interrupted prior attempt
     - MAY use a different adapter instance, transport
       session, or connection
     - MAY produce different events than the interrupted
       attempt
     - MAY return a different result than the interrupted
       attempt would have returned

     The result of the new submission becomes the new
     durable result, journaled as a fresh CloseEvent. This
     is a forward continuation, not a reproduction.

### 13.4 Execution Handle Reconstruction

RD6. On replay, the runtime MUST reconstruct execution
     handles at the same program points, using
     deterministic token derivation (EH5–EH7). The
     reconstructed handle MUST refer to the same child
     coroutineId.

RD7. The runtime MUST reset the consumed flag on
     reconstructed handles. Replay must re-exercise the
     same consumption path as the original execution.

### 13.5 Replay Requirements and Non-Requirements

RP1. Replay MUST reconstruct logical session semantics —
     the ordered sequence of plan inputs and their durable
     results — from the journal. Replay MUST NOT rely on
     reconstructing specific transport connections, session
     IDs, or process IDs from prior runs.

RP2. Replay MAY execute against a fresh adapter instance.
     A fresh adapter instance is conforming provided it:
     (a) returns the stored result for Case B plan
         executions without contacting the backend, and
     (b) submits a new live plan request for Case A plan
         executions and journals the new result.

RP3. The following properties MUST be deterministic across
     replay:
     (a) The ordering of plan steps within a session
         (determined by program order and journal replay).
     (b) The final durable result of each Case B plan
         execution (read from journal, never re-executed).
     (c) Execution handle token derivation (EH5–EH7).

RP4. For Case A replay: the runtime MUST submit a new plan
     request from scratch over the transport. The
     implementation MUST NOT restart the configured
     transport process. The new request is fully
     independent of the interrupted prior attempt. No
     property of the prior attempt (events, timing,
     adapter state, provider-side execution identity) is
     carried forward or required to match.

RP5. The following properties are explicitly NOT normative
     replay requirements. A conforming implementation MAY
     vary these across replay runs:
     (a) Session IDs or connection identifiers.
     (b) OS process IDs.
     (c) Whether the same transport connection is reused.
     (d) Events produced by a Case A new submission.
     (e) The result produced by a Case A new submission
         (it becomes the new durable result going forward;
         it is not required to equal any prior result).

RP6. The observable equivalence requirement for replay is
     narrow: for each Case B plan execution, the replayed
     execution MUST return the value recorded in the
     journal's CloseEvent. For Case A, the new submission's
     result becomes the new durable value; no equivalence
     to any prior result is required.

### 13.6 Teardown Semantics

The following three teardown boundaries are normative and
independent. They MUST NOT be conflated.

**Session close (TD1–TD3):**

TD1. Session close is triggered by scope exit of the scope
     in which `open()` or `fork()` was called (CC3, FK9).

TD2. Session close MUST:

     (a) Release the session handle over the transport,
         signalling to the adapter that this session is
         ending.

     (b) Cancel any in-flight plan execution occupying the
         session slot. This cancellation is the ordinary
         Effection structured-concurrency consequence of
         the session resource's scope ending — it is NOT
         a second independent cancellation mechanism.
         Specifically: the session resource child scope
         exits, which tears down any execution task that
         is a child of that scope, triggering execution
         close (TD4–TD6) exactly once for that execution.

     (c) Prevent further `plan()` and `fork()` calls on
         this session capability (SL3–SL4).

TD2f. The adapter MUST NOT receive duplicate abort signals
      as a result of a single session close. Session-close
      adapter notification (TD2a) and execution-abort
      adapter signal (TD5 path, for in-flight execution)
      are distinct operations on distinct resources and
      MUST be issued at most once each per resource.
      Implementations MUST guard against double-abort at
      the adapter boundary.

TD3. Session close MUST NOT:

     (a) Terminate the configured transport process.
     (b) Affect any other open session over the same
         transport.
     (c) Block on transport-level acknowledgment.

**Execution close (TD4–TD6):**

TD4. Execution close is triggered by: plan execution
     completion (result or error), supervise handler
     failure (SV9), or enclosing scope exit before the
     execution completes (PL4).

TD5. Execution close MUST complete the following steps
     in order:

     (a) Record the durable result: journal the child
         CloseEvent with the result value (or error
         status). This step completes first.
     (b) Close the event stream. No further events are
         delivered after this point.
     (c) Release the execution's event buffer.
     (d) Vacate the session slot. The slot becomes
         available for the next `plan()` call. The slot
         MUST NOT be vacated before step (a) completes.
         Once step (a) is complete, steps (b)–(d) MAY
         proceed in any order, but the slot MUST be
         vacant by the time execution close concludes.

TD6. Execution close MUST NOT:

     (a) Close the session. The session remains open and
         available for further plan calls after execution
         close.
     (b) Terminate the configured transport process.
     (c) Release or invalidate the parent session
         capability.

**Transport shutdown (TD7–TD9):**

TD7. Transport shutdown is the termination of the
     configured transport process. It is triggered
     exclusively by adapter-internal or deployment-level
     events, never by any session or execution lifecycle
     event in this specification.

TD8. Transport shutdown MUST NOT be triggered by:
     (a) Any `open()` call or its scope exit.
     (b) Any `fork()` call or its scope exit.
     (c) Any `plan()` call, execution completion, or
         supervise handler failure.

TD9. The effects of transport shutdown on open sessions are
     adapter-internal. A conforming Tisyn runtime MAY
     propagate transport-level errors to any in-flight plan
     execution as an execution error. Recovery behavior is
     not mandated.

### 13.7 Transport Ownership Boundaries (Summary)

TW1. The configured ACP stdio transport and its underlying
     OS process are transport-owned. Their lifecycle is
     outside the normative surface of this specification.

TW2. The following are session-owned and governed by this
     specification: session handle acquisition (CC1),
     session close (TD1–TD3), plan execution dispatch and
     slot management (PL1–PL4, SV9), branch session
     acquisition and close (FK2, FK9).

TW3. The following are transport-owned and adapter-internal,
     NOT normative: starting or stopping the configured
     transport process; ACP stdio framing and protocol;
     session ID assignment and reuse; transport-level
     reconnection.

TW4. At session close (TD1–TD3), the implementation MUST
     release the session handle and MUST NOT kill the
     configured transport process.

TW5. At branch close (FK9 / TD1–TD3), the implementation
     MUST release the branch session handle, MUST NOT kill
     the configured transport process, and MUST NOT affect
     the parent session handle.

---

## 14. Conformance Requirements

### 14.1 MUST-Pass Tests

| ID | Description | Validates |
|----|-------------|-----------|
| CC-001 | `ClaudeCode().open(...)` returns a capability with `plan` and `fork` methods | §3.1, CC1 |
| CC-002 | Scope teardown releases session; transport process is not terminated | CC3, TD1–TD3, TW4 |
| CC-003 | Replay reconstructs the session-scoped capability at the same program point | CC5, RP1–RP3 |
| CC-004 | `plan()` after session close produces a descriptive error | SL3 |
| CC-005 | `fork()` after session close produces a descriptive error | SL4 |
| CC-006 | Concurrent `plan()` on same session is rejected before adapter contact | SL5, PL1 |
| CC-007 | Session capability remains valid after execution close | TD6(a)–TD6(c) |
| EH-001 | `cc.plan(...)` returns an execution handle | EH1 |
| EH-002 | Execution handle token is deterministic across executions with same IR | EH5 |
| DJ-001 | `yield* planned` returns the plan's final result | DJ1, DJ2 |
| DJ-002 | `yield* planned` after execution already completed returns immediately | DJ7 |
| DJ-003 | Execution failure propagates through join | DJ3, DJ8 |
| DJ-004 | Events are not observed in the direct-join path | DJ4 |
| SV-001 | `supervise(planned, handler)` returns the final result on completion | SV7 |
| SV-002 | Handler is invoked for each event in order | SV5, SV6 |
| SV-003 | Handler failure cancels execution; session remains valid | SV9, TD6 |
| SV-004 | Execution failure during supervision propagates to caller | SV10 |
| SV-005 | `supervise` with no events returns result immediately | SV11 |
| SC-001 | Second consumption of same handle is rejected (join then join) | SC1, SC3 |
| SC-002 | Second consumption of same handle is rejected (supervise then join) | SC1, SC3 |
| SC-003 | Second consumption of same handle is rejected (join then supervise) | SC1, SC3 |
| ED-001 | Events emitted before `supervise` is called are delivered to the handler | ED1, ED2 |
| EV-001 | Events are not in the journal after execution | EV4 |
| EV-002 | Events are not produced during replay (Case B) | EV5 |
| RD-001 | Final result is journaled as child CloseEvent | PL9 |
| RD-002 | Replay Case B: stored result returned without re-executing Claude planning | EH8, RP6 |
| CC-009 | Session slot vacates only after CloseEvent is journaled; not on backend completion | TD5(a), SL1 |
| FK-001 | `cc.fork()` returns a `ClaudeCodeBranch` with `plan` but not `fork` | FK3, FK10 |
| FK-002 | Planning on a branch does not mutate parent state | FK4 |
| FK-003 | Planning on parent does not mutate branch state | FK5 |
| FK-004 | Branch close does not affect parent session or transport process | FK9, TW5 |
| FK-005 | `fork()` failure: error catchable; parent session, slot, and state unchanged | FK2d |
| FK-006 | `fork()` during in-flight execution: child sees only committed state | SL6, FK2a |
| RP-001 | Replay Case B: equivalent final result against fresh adapter instance | RP2, RP6 |
| TW-001 | Multiple sequential sessions share the configured transport | TW1, LO1 |

### 14.2 SHOULD-Pass Tests

| ID | Description | Validates |
|----|-------------|-----------|
| CC-010 | Compiler rejects handle passed as agent argument | EH4 |
| CC-011 | Compiler rejects handle returned from workflow | EH4 |
| CC-012 | Compiler rejects handle stored in object | EH4 |
| CC-013 | Compiler warns on unconsumed handle | SC4 |
| SV-010 | Handler may perform `yield*` effects | SV2 |
| SV-011 | Runtime delivers unknown event types to handler without rejection | EV2 |
| FK-010 | Multiple forks from same parent are independent | FK6 |
| FK-011 | Fork produces independent execution history from parent | FK4, FK5 |
| RD-003 | Replay Case A: session close causes exactly one execution-abort at adapter | TD2, TD2f |

---

## 15. Deferred Extensions

### 15.1 `accept()` Operation

Deferred pending resolution of execution/apply semantics.

### 15.2 Durable Event Streaming

Events consumed as durable workflow data are deferred.

### 15.3 Merge and Promote

Deferred (FD1, FD2).

### 15.4 Cross-Branch Communication

Deferred (FD3).

### 15.5 Branch-of-Branch

Deferred (FD4).

### 15.6 Multi-Model Routing

Deferred. The session uses the model configured at open
time.

### 15.7 Generic ACP Abstraction

Deferred. This spec is Claude Code-specific.

### 15.8 Structured Output Enforcement

Deferred.

### 15.9 Cost / Token Budget Management

Deferred.

### 15.10 Transport Lifecycle Management

Operations to start, stop, or restart the configured ACP
stdio transport process from within an authored workflow are
deferred. Transport process management is a deployment and
configuration concern.

---

## Appendix A. Worked Example

````typescript
import { main } from "effection";
import { ClaudeCode, supervise } from "@tisyn/claude-code";

function* planRefactoring() {
  // Acquire a session over the configured ACP stdio transport.
  // Does NOT start a new OS process.
  const cc = yield* ClaudeCode().open({
    cwd: "/home/user/project",
    systemPrompt: "You are a refactoring planner.",
    model: "claude-sonnet-4-20250514",
  });

  // First plan: occupies the session slot.
  const planned = yield* cc.plan({
    prompt: "Refactor the auth module for testability",
  });

  // Supervise: handler can abort by throwing; session survives.
  const proposal = yield* supervise(
    planned,
    function* (event) {
      const d = event.data as Record<string, unknown>;
      if (event.type === "text") {
        console.log("[plan]", d.content);
      }
      if (event.type === "tool_start" && d.toolName === "write_file") {
        throw new Error("Plan mode should not write files");
      }
    },
  );
  // Execution close vacates the slot. Session remains valid.

  // Second plan: slot is now vacant, dispatch is permitted.
  const planned2 = yield* cc.plan({ prompt: "Summarize the key changes" });
  const summary = yield* planned2;
  // Slot vacated again.

  // Fork: effectful, may fail. Parent session unaffected on failure.
  const branch = yield* cc.fork();

  // Branch has its own slot; parent slot is independent.
  const altPlanned = yield* branch.plan({
    prompt: "Now try a microservices decomposition instead",
  });
  const altProposal = yield* altPlanned;

  // Branch session closes at scope exit.
  // Parent session and transport process are unaffected.

  return { main: proposal, summary, alternative: altProposal };
}
````

---

## Appendix B. Relationship to Existing Specifications

| Existing pattern | Relationship |
|-----------------|-------------|
| Resource (Resource Spec §1.4) | `open()` and `fork()` create resources. `fork()` follows resource initialization failure semantics. Teardown is session handle release, not process termination. |
| Spawn (Spawn Spec §1) | Plan execution is analogous to a spawned background task. Execution handle borrows joinability but is a distinct capability type. |
| Stream iteration (SI Spec §7) | Event observation is analogous to stream consumption. `supervise(...)` is a distinct authored form with result delivery and cancellation coupling. |
| LLM Sampling (Sampling Spec §1) | Coexists. `llm.sample` is the generic one-shot surface. |
| Restricted capabilities | Execution handle is the third restricted capability type. |

---

## Appendix C. Lifecycle Boundary Summary

| What | Owned by | Created by | Released/destroyed by |
|------|----------|-----------|----------------------|
| Configured transport process | Transport layer | Deployment/config | Deployment/config; NEVER by session or execution lifecycle |
| ACP stdio transport channel | Transport layer | Adapter startup | Adapter shutdown; NEVER by session close |
| Session handle | Session resource | `open()` | Session close (TD1–TD3) |
| Session slot | Session resource | `open()` | Session close (TD1–TD3); vacated transiently by each execution close |
| Branch session handle | Child session resource | `fork()` | Branch close (FK9 / TD1–TD3) |
| Plan execution task | Execution handle | `cc.plan(...)` | Execution close (TD4–TD6) |
| Event buffer | Execution handle | `cc.plan(...)` | Execution close (TD4–TD6) |
| Final result journal entry | Journal | Execution completion (Case B) or Case A new submission | Never (durable) |

---

## Appendix D. Implementation-Defined Behaviors

| Behavior | Normative anchor |
|----------|-----------------|
| ACP protocol message shapes and field names | §1.3 |
| stdio framing details | §1.3 |
| Session ID format and assignment strategy | §1.3; FK2e |
| Whether transport connection is reused between sessions | FK2c |
| Whether `open()` reuses an existing transport or opens a new one | §1.3 |
| Fork isolation mechanism (snapshot-and-clone, protocol-level fork, etc.) | FK2c |
| The specific error condition that triggers `fork()` failure | FK2d |
| Exact compiler lowering strategy for `open()` as a resource | CC10 |
| Execution handle token format | EH7 |
| Plan result schema | PL7 |
| Configuration fields beyond `cwd`, `systemPrompt`, `model` | CC9 |
| Behavior when transport process is unavailable at `open()` time | §15.10 deferred |
| Recovery behavior when transport shutdown affects open sessions | TD9 |
| The specific result produced by a Case A new live submission | RP5(e) |
