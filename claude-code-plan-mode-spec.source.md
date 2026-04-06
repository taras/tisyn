# Tisyn Claude Code Plan Mode Specification

**Version:** 0.1.5
**Implements:** Tisyn System Specification 1.0.0
**Amends:** Tisyn Kernel Specification 1.0.0, Tisyn Compiler
Specification 1.2.0
**Depends on:** Tisyn Resource Specification 0.1.0, Tisyn
Blocking Scope Specification 0.1.0, Tisyn Spawn Specification
0.1.0, Tisyn LLM Sampling Specification 1.0.0 (coexists —
does not replace)
**Status:** Draft

---

## 1. Overview

This specification defines the Claude Code Plan Mode
integration surface for authored Tisyn workflows. It
introduces three new constructs:

1. A **session-scoped Claude Code capability** returned by
   `ClaudeCode().open(...)`, backed by a stateful session
   resource with scope-bound lifetime.

2. An **execution handle** returned by `cc.plan(...)`, a
   new restricted capability type that represents one
   in-flight plan execution. The handle supports direct
   join for the final result or supervised consumption for
   event observation with final result delivery.

3. A **session fork** via `cc.fork()`, a session-topology
   operation that creates an isolated child session for
   exploratory branching.

The target authored surface is:

````typescript
const cc = yield* ClaudeCode().open({
  cwd: "/project",
  systemPrompt: "Plan refactoring tasks",
});

// Plan and supervise
const planned = yield* cc.plan({
  prompt: "Refactor the auth module for testability",
});
const result = yield* supervise(planned, function* (event) {
  console.log(event.type, event.data);
  if (isWrongTurn(event)) {
    throw new Error("wrong turn");
  }
});

// Or: plan and join directly
const planned2 = yield* cc.plan({ prompt: "..." });
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
- the execution-handle restricted capability type for plan
  executions
- direct join semantics for execution handles
- supervised consumption semantics via `supervise(...)`
- single-consumer ownership rules and enforcement model
- event delivery contract
- session fork semantics
- replay and durability rules
- conformance test requirements

### 1.3 What This Specification Does Not Cover

The following are explicitly outside this specification's
scope. They correspond to deferred extensions in §15.

- `accept()` operation semantics (execution/apply semantics
  not yet clear)
- Full plan/accept lifecycle
- Durable event streaming (events consumed as durable
  workflow data)
- Merge/promote for forked sessions
- Cross-branch communication
- Multi-model selection or routing within the Claude Code
  session
- Generic ACP abstraction beyond what is needed for this
  integration
- Adapter/transport internals (implementation detail)
- Claude Agent SDK or ACP protocol details (adapter concern)

### 1.4 Relationship to LLM Sampling Specification

This specification coexists with the LLM Sampling
Specification. `llm.sample` remains the generic one-shot
sampling abstraction for any LLM backend. The Claude Code
execution handle is a richer, specialized surface for
session-based Plan Mode planning with event supervision.

Workflows MAY use both `llm.sample` and `cc.plan(...)` in
the same program. They are independent effect surfaces that
do not interact.

### 1.5 Key Design Decisions

This specification makes the following concrete choices:

- The session-scoped capability merges session and agent
  facade at the public API level. Underneath, resource
  lifetime and replay reconstruction still apply.
- The execution handle is a genuinely new restricted
  capability type. It borrows ideas from spawn task handles
  (joinability) and stream subscriptions (event iteration),
  but is not an instance of either.
- `supervise(...)` is a distinct authored form. It is not
  a reuse of `forEach`, `each`, or any existing stream
  helper.
- Events are buffered from execution start until
  supervision begins. All events are available to the
  first `supervise` call on the handle.
- `fork()` is a session-topology / resource-derivation
  operation, not an ordinary agent effect. It is exposed
  on the capability for ergonomics.

---

## 2. Terminology

**Session-scoped capability.** The value returned by
`ClaudeCode().open(...)`. It is the main user-facing
Claude Code value. It exposes `plan(...)` and `fork()`
methods. It is backed by a stateful session resource with
scope-bound lifetime.

**Session resource.** The underlying resource that owns
the Claude Code process or connection. Created during
`open()`, torn down when the enclosing scope exits. The
session-scoped capability remains valid only while this
resource is alive.

**Execution handle.** A restricted capability value
representing one in-flight plan execution. It supports
two authored uses: direct join and supervised consumption.
Exactly one of these MUST be used per handle instance.

**Direct join.** `yield* planned` — the parent suspends
until the plan execution completes, then resumes with the
final result. Events are not observed.

**Supervised consumption.** `yield* supervise(planned,
handler)` — the parent processes events from the plan
execution via a structured per-event generator operation,
then receives the final result when the execution
completes. If the handler fails, the execution is
cancelled.

**Handler operation.** The generator function passed to
`supervise(...)`. It is a structured per-event workflow
operation — not a free-floating callback. It executes as
ordinary workflow work inside the supervision loop and
MAY perform `yield*` effects.

**Plan execution.** The background task spawned by
`cc.plan(...)`. It communicates with the Claude Code
backend, produces events, and completes with a final
result.

**Session fork.** `cc.fork()` — a session-topology /
resource-derivation operation that creates an isolated
child session from the parent's current conversational
state.

**Event.** An ephemeral, non-durable observation of
in-flight plan execution activity. Events are not
journaled and not replayed.

**Final result.** The durable completion value of a plan
execution. It is journaled and replayed normally.

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

### 3.2 `ClaudeCode().open(...)`

CC1. `ClaudeCode().open(input?)` MUST acquire or create a
     Claude Code session and return a session-scoped
     capability value.

CC2. The returned value MUST be backed by a stateful session
     resource. The resource's lifetime is bounded by the
     scope in which `open()` is called.

CC3. When the enclosing scope exits — whether by normal
     completion, error, or cancellation — the session
     resource MUST be torn down. Teardown shuts down the
     Claude Code process or connection.

CC4. The session-scoped capability MUST remain valid only
     while its backing resource is alive. Using the
     capability after the resource is torn down is
     undefined behavior; the runtime SHOULD reject such
     use with a descriptive error.

CC5. On replay, the runtime MUST reconstruct a semantically
     equivalent session-scoped capability at the same
     program point. The session's conversational state is
     rebuilt from the replayed execution history relevant
     to that session — including initialization effects
     and the effects of any prior `plan()` calls whose
     results were journaled. The session's internal state
     is NOT independently persisted as a mutable snapshot;
     it is a consequence of replaying the session's
     durable history.

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
      capability rules as `ClaudeCodeCC` (CC6–CC7).
      A branch capability MUST NOT be passed as an
      argument to an agent method, returned from a
      workflow, stored in an object or array, or included
      in a journal event result value. The only
      distinction is that `ClaudeCodeBranch` does not
      expose `fork()` (FK3).

### 3.4 Configuration Input

CC9. `ClaudeCodeOpenInput` MUST support at minimum:

     - `cwd` (optional string): working directory for the
       Claude Code session
     - `systemPrompt` (optional string): system prompt for
       the session
     - `model` (optional string): model identifier

     Additional fields are implementation-defined. The spec
     does not mandate a closed set of configuration fields
     for v1.

### 3.5 Authored Form

CC10. `yield* ClaudeCode().open(...)` is a resource-
      creating operation. The implementation MUST ensure
      that the returned capability is backed by a session
      resource with the lifetime semantics defined in
      CC2–CC5. The exact compiler lowering strategy is
      implementation-defined.

CC11. The compiler MUST NOT require a separate
      `useClaudeCodeAgent(session)` call. The returned
      value is the facade directly.

---

## 4. Execution Handle

### 4.1 What It Is

EH1. `cc.plan(input)` MUST return an execution handle — a
     restricted capability value representing one in-flight
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

EH6. The identity allocation rule is part of the execution-
     handle abstraction. It is not governed by the spawn
     specification. The implementation MAY draw on spawn's
     deterministic `childSpawnCount` scheme for inspiration,
     but the execution handle's token derivation MUST be
     specified and validated independently.

EH7. The token MUST incorporate:
     - the parent coroutineId
     - a monotonic counter within the parent's scope

     The exact format is implementation-defined but MUST be
     deterministic given the same program and the same
     replay journal.

### 4.4 Replay Reconstruction

EH8. On replay, the runtime MUST reconstruct a semantically
     equivalent execution handle at the same program point.
     The reconstructed handle MUST refer to the same child
     coroutineId whose journal entries are being replayed.

EH9. The reconstruction approach SHOULD follow the general
     restricted-capability reconstruction pattern used
     elsewhere in Tisyn (spawn handles are reconstructed
     from deterministic `childSpawnCount`; stream
     subscriptions from deterministic subscription
     counters). However, the execution handle's exact
     reconstruction rule is part of this abstraction and
     MUST be validated independently.

EH10. The runtime MUST maintain a consumed/not-consumed flag
      per handle for backstop enforcement of the single-
      consumer rule during replay.

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
     possible. The compiler SHOULD reject programs that:

     - use the same handle in both `yield* handle` and
       `supervise(handle, handler)`
     - use the same handle in two `supervise` calls
     - use the same handle in two `yield* handle`
       expressions

SC3. The runtime MUST reject invalid second consumption as
     a correctness backstop for cases that escape static
     detection. The runtime MUST produce a descriptive
     error: "execution handle already consumed."

SC4. If a handle is bound but never consumed (unconsumed
     handle), the execution still runs, its result is still
     journaled, but events are unobserved and the result
     value is discarded. The compiler SHOULD emit a warning
     for unconsumed handles.

### 5.2 Exhaustiveness

SC5. If the handle is consumed in one branch of an `if`,
     it MUST be consumed in the other branch too (or not
     referenced at all in either branch). The compiler
     SHOULD enforce this statically.

SC6. The runtime MUST maintain a minimal consumed/not-
     consumed flag per handle instance. This flag is set
     when the handle is first consumed (by join or
     supervise). Any subsequent consumption attempt MUST
     be rejected.

### 5.3 Why Single-Consumer

Multiple consumers create ambiguity:

- Two supervisors on the same handle: which one receives
  each event? Are events duplicated or split?
- Supervise then join: the supervisor already consumed
  the final result.
- Join then supervise: the join already waited for
  completion. No events remain.

Single-consumer eliminates these questions. The ownership
model is designed for strong static enforcement, with
runtime rejection as a correctness backstop.

---

## 6. Direct Join

### 6.1 Semantics

````typescript
const result = yield* planned;
````

DJ1. `yield* handle` MUST suspend the parent at the yield
     site until the plan execution completes.

DJ2. When the execution produces a final result, the parent
     MUST resume with that value.

DJ3. If the execution fails, the error MUST propagate to
     the parent. The error MAY be caught via `try/catch`
     around the join expression.

DJ4. Events produced during execution MUST NOT be observed
     in the direct-join path. They are emitted by the
     execution's background task but no subscriber exists.
     They are lost — identical in behavior to unobserved
     Progress notifications.

DJ5. The join does not start the execution. The execution
     was spawned at `cc.plan(...)` and is already running.
     The join waits for an already-running execution.

DJ6. Direct join consumes the handle (SC1). No subsequent
     join or supervise call on the same handle is
     permitted.

### 6.2 Completion Before Join

DJ7. If the execution completed before the parent reaches
     `yield* planned`, the join MUST return immediately
     with the stored result. The child's journal entries
     (including the child's CloseEvent) are already
     written; the runtime returns the stored value.

### 6.3 Error Propagation

DJ8. If the execution fails:

     (a) The child task throws.
     (b) The child's CloseEvent is written with
         `status: "err"`.
     (c) The join propagates the error to the parent.

     This is analogous to spawn join error propagation
     (Spawn Spec §10.2–10.3). The execution handle's
     error path follows the same waiting/error shape, but
     the handle remains a distinct capability because the
     underlying execution also has an event surface.

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
     operation. It is NOT a free-floating callback.

SV2. The handler MUST execute as ordinary workflow work
     inside the supervision loop. It MAY perform `yield*`
     effects.

SV3. If the handler fails (throws), the failure follows
     ordinary operation failure semantics: the supervision
     scope tears down, which cancels the underlying
     execution (see §7.4).

### 7.3 Supervision Lifecycle

SV4. `supervise(handle, handler)` MUST subscribe to the
     execution handle's event stream and begin processing
     events.

SV5. For each event, the handler operation MUST be
     invoked with the event value. The handler runs in
     the foreground: the next event MUST NOT be delivered
     until the current handler invocation completes. This
     provides natural backpressure.

SV6. Events MUST be delivered in the order the execution
     produced them. No reordering.

SV7. When the execution completes (the event stream
     closes), `supervise` MUST return the execution's
     final result. The caller receives the result as the
     return value of `yield* supervise(...)`.

SV8. `supervise` consumes the handle (SC1). No subsequent
     join or supervise call on the same handle is
     permitted.

### 7.4 Cancellation Coupling

SV9. If the handler operation fails:

     (a) `supervise` catches the error.
     (b) `supervise` cancels the execution's background
         task via structured concurrency teardown.
     (c) The execution's Effection scope is torn down.
     (d) The Claude Code operation is aborted.
     (e) `supervise` re-throws the error to the caller.

     This cancellation coupling is the key semantic
     property: the handler operation can abort the
     execution by throwing.

### 7.5 Execution Failure During Supervision

SV10. If the execution fails while supervision is active,
      the error MUST propagate to the `supervise` caller.
      The handler is not invoked for the error — the error
      terminates the supervision loop.

### 7.6 No Events Produced

SV11. If the execution completes without emitting any
      events, `supervise` MUST return the final result
      immediately. The handler is never invoked. This is
      a normal case — some executions may be fast enough
      to complete without intermediate events.

### 7.7 `supervise` Is Not Stream Iteration

SV12. `supervise(...)` is a distinct authored form specific
      to execution handles. It MUST NOT be conflated with
      `forEach(...)`, `each(...)`, or any existing Effection
      stream helper.

      | Property | `each(stream)` | `supervise(handle, handler)` |
      |----------|---------------|------------------------------|
      | Source | Any Effection Stream | Execution handle only |
      | Returns | void (TClose not exposed) | Final result (R) |
      | On handler failure | Loop exits, scope teardown | Execution cancelled, error propagates |
      | Multiple consumers | Multiple subscriptions | Single consumer only |

SV13. The compiler MAY recognize `supervise(...)` as a
      compiler form (like `each`) for static enforcement
      of the single-consumer rule at the call site. If
      the compiler does not recognize it, the runtime MUST
      enforce single-consumer semantics via the handle's
      consumed flag.

---

## 8. Event Delivery Contract

### 8.1 Buffering Policy

ED1. Events MUST be buffered from execution start. The
     execution's background task begins producing events
     at the point `cc.plan(...)` is called. Events
     produced between handle creation and `supervise`
     invocation MUST be retained.

ED2. When `supervise` subscribes, it MUST receive all
     buffered events in order, followed by any events
     produced during supervision.

ED3. All events produced from execution start are
     available to the first `supervise` call on the
     handle, regardless of the delay between
     `cc.plan(...)` and `supervise(...)`.

### 8.2 Justification

Buffered-from-start is the v1 default because:

- The typical authored pattern is `cc.plan(...)` followed
  by `supervise(...)`. Dropping early events (e.g.,
  initial plan formation steps) would be surprising.
- For v1, Claude Code plan executions produce bounded
  event volumes per operation. Unbounded buffering is not
  a practical concern.

### 8.3 Direct Join

ED4. In the direct-join path, events are produced but no
     subscriber exists. The buffer is allocated but never
     drained. It is discarded when the execution completes
     or the scope is torn down.

### 8.4 Future Policy

ED5. A future specification MAY introduce bounded buffers
     or drop policies for high-volume event sources. The
     v1 contract defined here does not preclude such
     extensions.

---

## 9. Event Taxonomy

### 9.1 Event Envelope

EV1. Each event MUST be a value with at least a `type`
     field (string) and a `data` field (any serializable
     value).

     ```typescript
     interface ExecutionEvent {
       type: string;
       data: unknown;
     }
     ```

EV2. The `type` field distinguishes event kinds. The set
     of `type` values is open — adapters MAY emit any
     type string. The runtime MUST treat the type set as
     open and MUST deliver events with unrecognized type
     strings to the `supervise` handler opaquely, without
     raising a runtime error solely because the type is
     unrecognized. Authored handlers MAY choose how to
     handle unknown event types (including ignoring them,
     logging them, or throwing).

EV3. Events MUST be delivered to the `supervise` handler
     in the order the execution produced them. No
     reordering.

### 9.1.1 Example Event Types (Non-Normative)

The following are representative event types that a Claude
Code adapter might emit. They are examples, not a closed
normative set. Implementations are free to use different
type strings or additional fields.

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

EV6. Events are non-durable and subject to the following
     non-guarantee boundaries:

     (a) Events are NOT preserved across crash and
         recovery. After a crash, events from the prior
         execution are permanently lost (RD5).
     (b) Events are NOT delivered if the handle is never
         supervised. If the handle is consumed via direct
         join (`yield* planned`), buffered events are
         discarded when the execution completes or the
         scope is torn down (ED4).
     (c) On live-frontier re-establishment (RD5 Case A),
         the re-established execution MAY produce
         different events than the prior run.

     Within a single non-crashed execution run, events
     are buffered from execution start and delivered to
     the first `supervise` call per §8 (ED1–ED3).

EV7. The same invariants that govern Progress in the
     Sampling Spec (PG1–PG7) apply to execution-handle
     events: they are ephemeral observation of in-flight
     execution, not durable workflow data.

### 9.3 Adapter Translation

EV8. The adapter (Claude Agent SDK, ACP, or other backend)
     MUST translate provider-native partial output into
     events conforming to the envelope defined in §9.1.
     The translation is adapter-internal.

EV9. The event envelope defined here is the Tisyn-facing
     contract. The `type` strings and `data` shapes used
     by a specific adapter are adapter-defined. The
     runtime does not interpret event content — it
     delivers events to the `supervise` handler opaquely.

---

## 10. Plan Operation

### 10.1 Semantics

PL1. `cc.plan(input)` MUST dispatch a plan request to the
     Claude Code backend via the session.

PL2. `cc.plan(input)` MUST spawn a background execution
     task. The parent continues immediately with the
     execution handle.

PL3. The background execution task MUST:
     (a) Send the plan request to the backend.
     (b) Receive streaming events and buffer them for
         potential supervision.
     (c) Receive the final result when the backend
         completes.
     (d) Close the event stream with the final result.

PL4. The background execution task is a child of the scope
     that contains `cc.plan(...)`. Its lifetime is bounded
     by that scope. If the scope exits before the execution
     completes, the execution is cancelled.

### 10.2 Plan Input

PL5. `ClaudePlanInput` MUST support at minimum:

     - `prompt` (string): the planning instruction

     Additional fields are implementation-defined.

### 10.3 Plan Result

PL6. The plan's final result is the completion value from
     the Claude Code backend, representing the formed plan
     or proposal.

PL7. The final result type is implementation-defined for
     v1. The specification does not mandate a closed schema
     for plan results.

### 10.4 Journaling

PL8. The plan dispatch (the `cc.plan(...)` call itself)
     MUST produce a child coroutineId for the background
     execution task.

PL9. The background execution task's effects and
     completion MUST be journaled under its coroutineId.
     The final result appears as the child's CloseEvent:

     ```
     Close(coroutineId: "<parent>.<N>",
           result: { status: "ok", value: <plan result> })
     ```

PL10. Events produced during execution MUST NOT be
      journaled. Only the final result is durable.

---

## 11. Session Fork

### 11.1 What Fork Is

FK1. `cc.fork()` is a session-topology / resource-
     derivation operation. It is NOT an ordinary agent
     effect like `plan()`.

FK2. `cc.fork()` MUST create a new session resource whose
     state is derived from the parent session's current
     conversational state.

FK3. `cc.fork()` MUST return a new `ClaudeCodeBranch` — a
     session-scoped capability backed by the child session
     resource. The branch capability exposes `plan()` but
     does NOT expose `fork()`. Recursive forking is
     deferred (FD4).

### 11.2 Isolation

FK4. The child session MUST be isolated from the parent.
     Subsequent `plan()` calls on the child MUST NOT
     mutate the parent session's state.

FK5. Operations on the parent MUST NOT mutate the child's
     state. The parent's conversation history MUST NOT
     include the child's planning activity.

FK6. Multiple forks from the same parent session MUST be
     permitted. Each fork MUST be independent. Forks MUST
     NOT see each other's state.

### 11.3 Lifetime

FK7. The child session is a new resource. Its lifetime
     MUST be bounded by the scope in which `fork()` is
     called.

FK8. The child session MUST NOT outlive the parent
     session's scope. If the parent scope exits, the
     child's scope is torn down first (standard structured
     concurrency ordering).

FK9. Branch teardown MUST discard branch state. When the
     branch's scope exits, the branch session MUST be
     shut down. No merge or promotion occurs
     automatically.

### 11.4 Usage

FK10. The returned capability is a `ClaudeCodeBranch`. The
      caller MAY call `plan(...)` on it to plan within the
      branch. The caller MUST NOT call `fork()` on a branch
      — recursive forking is not part of this specification.

````typescript
const branch = yield* cc.fork();

const planned = yield* branch.plan({
  prompt: "Try a different approach",
});
const result = yield* planned;
// branch is torn down when this scope exits
````

### 11.5 Replay

FK11. The fork operation MUST produce a child coroutineId
      for the child session resource.

FK12. On replay, the fork's initialization effects MUST be
      replayed under the fork's child coroutineId,
      reconstructing the branch capability.

FK13. The branch session's internal state (Claude Code
      conversation context) is NOT independently journaled
      as a mutable snapshot. It is rebuilt from the
      replayed execution history for that branch —
      including the fork's initialization effects and the
      effects of any `plan()` calls made on the branch
      whose results were journaled.

### 11.6 Deferred Fork Extensions

FD1. **No merge.** Branch results do not automatically
     flow back into the parent session. If the workflow
     needs the branch's result in the parent context, it
     uses the plan's final result value (returned via the
     execution handle) and passes it to the parent
     explicitly.

FD2. **No promote.** There is no operation to replace the
     parent session's state with a branch's state.

FD3. **No cross-branch communication.** Branches do not
     send events or results to each other. They are
     independent resource scopes.

FD4. **Branch-of-branch.** Recursive forking — a branch
     calling `fork()` on itself — is not supported in this
     specification. `ClaudeCodeBranch` does not expose
     `fork()`. A future specification MAY introduce a
     recursive branch type if the use case warrants it.

---

## 12. Session Topology

### 12.1 Tree Structure

ST1. With `plan` and `fork`, the session model forms a
     tree:

     ```
     Parent session (resource)
     ├── plan execution A (execution handle)
     ├── plan execution B (execution handle)
     ├── Branch X (forked session resource)
     │   └── plan execution C (execution handle)
     └── Branch Y (forked session resource)
         └── plan execution D (execution handle)
     ```

ST2. Each node is either a resource (session/branch) or
     an execution (handle). Lifetimes are strictly nested
     — children MUST NOT outlive parents.

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

RD2. The following MUST NOT be journaled:

     | Artifact | Journaled? | Reason |
     |----------|-----------|--------|
     | Execution events | No | Observational only |
     | Session internal state | No | Reconstructed by replay |
     | Execution handle value | No | Reconstructed at program point |
     | Branch internal state | No | Reconstructed by replay |

### 13.2 No New Persistence Surface

RD3. This specification MUST NOT introduce new durable
     event kinds beyond YieldEvent and CloseEvent.

RD4. This specification MUST NOT introduce new persistence
     machinery beyond the existing journal.

RD5. The replay contract for plan executions distinguishes
     two cases:

     **Case A — Final result not yet journaled.** Replay
     reaches the live frontier (the plan execution's
     CloseEvent has not been written). The runtime MUST
     re-establish the plan execution live. The execution
     resumes against the Claude Code backend. Events from
     the prior (pre-crash) execution are permanently lost.
     New events MAY be produced by the re-established
     execution but are not guaranteed to match the prior
     execution's events.

     **Case B — Final result already journaled.** The plan
     execution's CloseEvent is in the journal. Replay MUST
     return the stored final result. Replay MUST NOT
     re-execute Claude planning. Replay MUST NOT regenerate
     or deliver events — the execution completed in a
     prior run and its events are permanently gone.

### 13.3 Execution Handle Reconstruction

RD6. On replay, the runtime MUST reconstruct execution
     handles at the same program points, using
     deterministic token derivation (EH5–EH7). The
     reconstructed handle MUST refer to the same child
     coroutineId.

RD7. The runtime MUST reset the consumed flag on
     reconstructed handles. Replay must re-exercise the
     same consumption path (join or supervise) as the
     original execution.

---

## 14. Conformance Requirements

### 14.1 MUST-Pass Tests

The following are conformance requirements. An
implementation that fails any of these tests is
non-conforming.

| ID | Description | Validates |
|----|-------------|-----------|
| CC-001 | `ClaudeCode().open(...)` returns a capability with `plan` and `fork` methods | §3.1, CC1 |
| CC-002 | Scope teardown closes the session | CC3 |
| CC-003 | Replay reconstructs the session-scoped capability at the same program point | CC5 |
| EH-001 | `cc.plan(...)` returns an execution handle | EH1 |
| EH-002 | Execution handle token is deterministic across executions with same IR | EH5 |
| DJ-001 | `yield* planned` returns the plan's final result | DJ1, DJ2 |
| DJ-002 | `yield* planned` after execution already completed returns immediately | DJ7 |
| DJ-003 | Execution failure propagates through join | DJ3, DJ8 |
| DJ-004 | Events are not observed in the direct-join path | DJ4 |
| SV-001 | `supervise(planned, handler)` returns the final result on completion | SV7 |
| SV-002 | Handler is invoked for each event in order | SV5, SV6 |
| SV-003 | Handler failure cancels the underlying execution | SV9 |
| SV-004 | Execution failure during supervision propagates to caller | SV10 |
| SV-005 | `supervise` with no events returns result immediately | SV11 |
| SC-001 | Second consumption of same handle is rejected (join then join) | SC1, SC3 |
| SC-002 | Second consumption of same handle is rejected (supervise then join) | SC1, SC3 |
| SC-003 | Second consumption of same handle is rejected (join then supervise) | SC1, SC3 |
| ED-001 | Events emitted before `supervise` is called are delivered to the handler | ED1, ED2 |
| EV-001 | Events are not in the journal after execution | EV4 |
| EV-002 | Events are not produced during replay | EV5 |
| RD-001 | Final result is journaled as child CloseEvent | PL9 |
| RD-002 | Replay returns stored result without re-executing Claude planning | EH8, DJ7 |
| FK-001 | `cc.fork()` returns a `ClaudeCodeBranch` with `plan` but not `fork` | FK3, FK10 |
| FK-002 | Planning on a branch does not mutate parent state | FK4 |
| FK-003 | Planning on parent does not mutate branch state | FK5 |
| FK-004 | Branch teardown does not mutate parent session | FK9 |

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

---

## 15. Deferred Extensions

The following are explicitly out of scope for this
specification version.

### 15.1 `accept()` Operation

The operation that applies or executes a formed plan. Its
execution/apply semantics are not yet clear:

- Does it start a new Claude Code execution?
- Does it modify the session's state?
- Should it return an execution handle or a plain value?

These questions can be resolved after the Plan Mode
execution-handle pattern is proven. The execution-handle
abstraction is designed to accommodate `accept()` later.

### 15.2 Durable Event Streaming

Events consumed as durable workflow data — where each
event is journaled and replay delivers the same event
sequence — are deferred. This corresponds to the Sampling
Spec DF4 deferred item.

### 15.3 Merge and Promote

Operations to merge a branch's results into the parent
session or to replace the parent's state with a branch's
state are deferred (FD1, FD2).

### 15.4 Cross-Branch Communication

Branches sending events or results to each other is
deferred (FD3).

### 15.5 Branch-of-Branch

Recursive forking (a branch calling `fork()` on itself)
is deferred (FD4).

### 15.6 Multi-Model Routing

Model selection or routing within the Claude Code session
is not covered by this specification. The session uses
whatever model is configured at open time (CC9).

### 15.7 Generic ACP Abstraction

A general-purpose ACP adapter abstraction that would
support non-Claude agents is not part of this
specification. This spec is Claude Code-specific.

### 15.8 Structured Output Enforcement

Constraining the plan result to a specific JSON schema is
deferred.

### 15.9 Cost / Token Budget Management

Resource limits on plan execution cost are deferred.

---

## Appendix A. Worked Example

````typescript
import { main } from "effection";
import { ClaudeCode, supervise } from "@tisyn/claude-code";

function* planRefactoring() {
  // Open a session-scoped Claude Code capability
  const cc = yield* ClaudeCode().open({
    cwd: "/home/user/project",
    systemPrompt: "You are a refactoring planner.",
    model: "claude-sonnet-4-20250514",
  });

  // Plan a refactoring with event supervision
  const planned = yield* cc.plan({
    prompt: "Refactor the auth module for testability",
  });

  const proposal = yield* supervise(
    planned,
    function* (event) {
      // event.type and event.data follow the open envelope (§9.1).
      // Provider-specific payload fields are inside event.data.
      const d = event.data as Record<string, unknown>;
      if (event.type === "text") {
        console.log("[plan]", d.content);
      }
      if (event.type === "tool_start") {
        console.log("[tool]", d.toolName);
        if (d.toolName === "write_file") {
          // Plan mode should not write files — abort
          throw new Error("Plan mode should not write files");
        }
      }
    },
  );

  console.log("Proposal:", proposal);

  // Fork to explore an alternative approach
  const branch = yield* cc.fork();

  const altPlanned = yield* branch.plan({
    prompt: "Now try a microservices decomposition instead",
  });
  const altProposal = yield* altPlanned; // direct join, no supervision

  // Branch is torn down when this scope exits.
  // Parent session is unaffected by branch activity.

  return { main: proposal, alternative: altProposal };
}
````

---

## Appendix B. Relationship to Existing Specifications

| Existing pattern | Relationship to this spec |
|-----------------|--------------------------|
| Resource (Resource Spec §1.4) | `open()` and `fork()` create resources. **Genuine reuse** of resource lifetime, teardown, and replay reconstruction. |
| Spawn (Spawn Spec §1) | Plan execution is **analogous** to a spawned background task. The execution handle borrows the joinability concept but is a distinct capability type. |
| Stream iteration (SI Spec §7) | Event observation is **analogous** to stream consumption. `supervise(...)` borrows the per-item processing concept but is a distinct authored form with result delivery and cancellation coupling. |
| LLM Sampling (Sampling Spec §1) | **Coexists**. `llm.sample` is the generic one-shot surface. This spec is the richer Claude Code-specific surface. |
| Restricted capabilities | The execution handle is the **third** restricted capability type, after spawn task handles and stream subscription handles. It follows the same restriction model but defines its own usage rules. |
