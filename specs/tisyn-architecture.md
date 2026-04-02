# Tisyn: Architecture and Design Rationale

**Document type:** Technical architecture
**Audience:** Engineers, architects, and system designers

---

## 1. Introduction

### 1.1 The Problem

Modern software systems are distributed. A business operation
that once lived inside a single process — place an order, check
for fraud, charge a card, send a confirmation — now spans
multiple services, each with independent failure modes. The
operation takes seconds or hours. It must survive server crashes,
network partitions, and service outages. And when something fails
partway through, the system must know what happened and what to
do next.

The standard approaches each solve part of the problem: retry
loops handle transient failures but not crashes; message queues
survive crashes but scatter workflow logic across consumer
definitions; the saga pattern handles partial failure but
requires every operation to have a compensating inverse;
database-backed state machines survive crashes but encode logic
as state tables. Each approach forces the developer to write
infrastructure alongside business logic.

### 1.2 The Insight

If you can replay a computation from a log of its external
interactions, you don't need to serialize its internal state. A
workflow that made three remote calls and received three results
can be reconstructed by creating a fresh instance and feeding it
the same three results. It will follow the same code path, create
the same local variables, make the same branching decisions, and
arrive at the same suspension point.

This requires two properties: **determinism** (same external
results → same path) and **effect isolation** (all external
interactions go through a recordable boundary). Traditional
programming languages violate both — JavaScript has
nondeterministic APIs and implicit side effects everywhere.

### 1.3 The Solution

Tisyn addresses this by separating programs into three concerns:

**Structure.** The workflow's logic is represented as an immutable
JSON document (the IR). It contains no nondeterminism, no side
effects, and no closures.

**Effects.** External interactions are represented as named
operations with serializable arguments. The kernel yields
descriptors to the execution layer, which dispatches them to
agents, records the results, and feeds them back.

**Journal.** Every effect result is appended to a durable log
before the kernel sees it. On crash, a new kernel reads the log,
replays stored results into a fresh evaluation, and resumes from
the crash point.

The developer writes generator functions in a restricted
TypeScript subset. A compiler transforms them into the IR. The
runtime evaluates the IR, dispatches effects, and manages the
journal. The developer never sees the IR, the journal, or the
replay mechanism.

---

## 2. Architectural Overview

### 2.1 The Pipeline

```
                    ┌────────────────────────────────────────────────┐
                    │                  Host Process                  │
User Code ──▶ Compiler ──▶ IR (JSON) ──▶ Validation                 │
                                              │                     │
                                        ┌─────▼──────┐             │
                                        │   Kernel   │◀── resume ─┐│
                                        │ (evaluator)│            ││
                                        └─────┬──────┘            ││
                                              │ EffectDescriptor  ││
                                        ┌─────▼───────────────┐   ││
                                        │  Execution Layer    │   ││
                                        │  ┌────────┐ ┌─────┐│───┘│
                                        │  │Replay  │ │Route││    │
                                        │  │Index   │ │     ││    │
                                        │  └───┬────┘ └──┬──┘│    │
                                        │      │         │   │    │
                                        │  ┌───▼───┐ ┌───▼─┐│    │
                                        │  │Journal│ │Trans││    │
                                        │  │(Durable│ │port ││    │
                                        │  │Stream) │ │Pool ││    │
                                        │  └───────┘ └──┬──┘│    │
                                        └───────────────┼───┘    │
                                        └───────────────┼────────┘
                                                        │ JSON-RPC 2.0
                              ┌──────────────────┼──────────────────┐
                              ▼                  ▼                  ▼
                        ┌──────────┐       ┌──────────┐       ┌──────────┐
                        │ Agent A  │       │ Agent B  │       │ Agent C  │
                        └────┬─────┘       └────┬─────┘       └────┬─────┘
                             ▼                  ▼                  ▼
                        External            External            External
                        Systems             Systems             Systems
```

### 2.2 Layer Responsibilities

| Layer               | Input                 | Output            | Responsibility                           | MUST NOT                               |
| ------------------- | --------------------- | ----------------- | ---------------------------------------- | -------------------------------------- |
| **Compiler**        | TypeScript generators | IR (JSON)         | Transform code to serializable tree      | Emit non-JSON, depend on runtime state |
| **Validation**      | IR (JSON)             | Validated IR      | Verify grammar, single-Quote rule, scope | Change the IR                          |
| **Kernel**          | IR + Environment      | Val or Suspend    | Evaluate expressions, yield effects      | Know about agents, journal, transport  |
| **Execution Layer** | Effect descriptors    | Results           | Replay or dispatch, journal, task mgmt   | Evaluate IR (delegates to kernel)      |
| **Agent**           | Execute message       | Result message    | Perform external work, return JSON       | Access journal, know about replay      |
| **Transport**       | JSON-RPC messages     | JSON-RPC messages | Deliver messages host ↔ agents           | Affect semantics                       |
| **Journal**         | Yield/Close events    | Stored events     | Durable append-only log                  | Lose acknowledged events               |

### 2.3 Boundaries

Three hard boundaries separate the layers:

**Compiler → Kernel.** The IR is JSON. No TypeScript types, no
closures, no functions, no prototypes. Between compilation and
evaluation, the IR is validated: grammar conformance, single-Quote
rule at every evaluation position, all Refs bound by enclosing
Let or Fn. Invalid IR is rejected before evaluation begins.

**Kernel → Execution Layer.** Effect descriptors are
`{ id: string, data: Val }` for standard effects and
`{ id: string, data: { exprs: Expr[] } }` for compound effects.
The kernel does not know how effects are dispatched, whether
results come from agents or from the journal, or how many agents
exist. The execution layer does not evaluate IR — it delegates
evaluation to the kernel.

**Execution Layer → Agent.** JSON-RPC 2.0 messages over a
transport. The agent does not know about the journal, replay,
task structure, or the IR. It receives a request and returns a
result. The agent is solely responsible for the correctness of
its external side effects — the kernel does not enforce, validate,
or roll back side effects.

---

## 3. Execution Flow

### 3.1 End-to-End: One Effect

The path of a single agent method call through the entire system:

```
Step  Component          Action
────  ─────────          ──────
 1    Developer          writes: const order = yield* OrderService().fetchOrder(id)
 2    Compiler           transforms to: Let("order", Eval("order-service.fetchOrder",
                                              [Ref("id")]), ...)
 3    Validation         checks: Eval data not quoted (external), Ref("id") bound
 4    Kernel             evaluates the Let, reaches the Eval node
 5    Kernel             classifies "order-service.fetchOrder" → EXTERNAL
 6    Kernel             calls resolve([Ref("id")], E) → ["order-123"]
 7    Kernel             yields Suspend({ id:"order-service.fetchOrder",
                                         data:["order-123"] })
 8    Execution Layer    checks ReplayIndex for coroutine "root", cursor 0
 9a   (replay)           entry found, description matches → feed stored result → step 13
 9b   (live)             no entry → continue to step 10
10    Execution Layer    parses id → type:"order-service", name:"fetchOrder"
11    Execution Layer    routes to Agent A, sends Execute message:
                           { id:"root:0", operation:"fetchOrder",
                             args:["order-123"] }
12    Agent A            executes fetchOrder, returns Result:
                           { ok:true, value:{ id:"order-123", total:150, ... } }
13    Execution Layer    constructs Yield event:
                           { type:"yield", coroutineId:"root",
                             description:{ type:"order-service", name:"fetchOrder" },
                             result:{ status:"ok", value:{ id:"order-123", ... } } }
14    Execution Layer    appends Yield to journal, awaits durable ack
15    Execution Layer    resumes kernel with the value
16    Kernel             binds "order" → { id:"order-123", total:150, ... }
17    Kernel             continues evaluating the Let body
```

**Steps 8-9** are the replay/live decision point. The kernel is
identical in both paths — it does not know which path was taken.

**Steps 13-15** are the persist-before-resume sequence. The Yield
is durably acknowledged before the kernel sees the result.

### 3.2 Correlation ID Flow

Each effect dispatch carries a correlation ID that flows through
the entire system:

```
Kernel yields effect              →  correlationId = "root:0"
                                      (taskId "root" + yieldIndex 0)
Execution Layer sends Execute     →  { "id": "root:0", ... }
Agent processes and responds      →  { "id": "root:0", "result": ... }
Execution Layer matches response  →  looks up "root:0" in pending set
Execution Layer writes Yield      →  event includes coroutineId "root"
```

The correlation ID is **deterministic**: the same effect in the
same workflow always produces the same ID (same taskId, same
yieldIndex). This stability across crashes and re-dispatches
enables agent-side deduplication.

### 3.3 Concurrency Flow

When the kernel encounters an `all` node:

```
Step  Component          Action
────  ─────────          ──────
 1    Kernel             reaches Eval("all", Q({exprs:[E1, E2]}))
 2    Kernel             classifies "all" → EXTERNAL (compound)
 3    Kernel             calls unquote(data, E) — NOT resolve
 4    Kernel             yields Suspend({ id:"all", data:{exprs:[E1,E2]} })
                         (child expressions preserved unevaluated)
 5    Execution Layer    creates child task "root.0" for E1
 6    Execution Layer    creates child task "root.1" for E2
 7    Execution Layer    each child receives parent's environment (pointer copy)
 8    Child root.0       evaluates E1, crosses its own effect boundaries
 9    Child root.1       evaluates E2, crosses its own effect boundaries
10    Execution Layer    collects results [R0, R1] in exprs order
11    Execution Layer    resumes parent kernel with [R0, R1]
```

**Step 3** is critical: `unquote` preserves child expressions.
If `resolve` were used, children would evaluate in the parent
task — no child tasks, no concurrent execution, wrong journal.

---

## 4. Intermediate Representation

### 4.1 Why an AST?

Most workflow engines execute workflows by running native code.
Temporal replays native functions; Azure Durable Functions
re-executes orchestrator code. Tisyn takes a different approach:
the workflow is data. The compiler transforms the developer's
code into a JSON tree, and the kernel evaluates that tree.

This has three consequences. **Determinism by construction:**
the tree contains no nondeterministic operations. The only
nondeterminism is external effects, captured by the journal.
**Inspectability:** the tree is JSON, serializable, diffable,
and visualizable. **Portability:** any language can evaluate
the same JSON tree.

### 4.2 The Five Node Types

```
Literal  — JSON values (numbers, strings, objects, arrays)
Eval     — a computation: { tisyn: "eval", id, data }
Quote    — a delayed expression: { tisyn: "quote", expr }
Ref      — a variable reference: { tisyn: "ref", name }
Fn       — a function value: { tisyn: "fn", params, body }
```

Every computation — from integer addition to cross-network agent
calls — is an `Eval` node. The kernel's classification function
determines whether an `Eval` is structural (evaluated locally)
or external (yielded to the execution layer).

### 4.3 Val vs Expr: Context-Based Classification

A fundamental design choice: the same JSON object can be either
an expression or a value, depending on where it appears.

- An **Expr** when the kernel encounters it during tree traversal.
- A **Val** when returned by `lookup()`, `eval()`, or received
  from an agent.

There is no structural `is_val` predicate. The origin determines
classification. This means agents can return any JSON data —
including objects that happen to contain `tisyn` fields — without
the system re-interpreting them as IR nodes.

### 4.4 Quote: The Delay Mechanism

Structural operations like `if` need their branches to be
unevaluated until the condition is checked. `Quote` prevents
evaluation, providing explicit call-by-name semantics.

**The single-Quote invariant:** structural operation data uses
exactly one Quote layer. The sub-expressions at positions the
operation evaluates must not be Quotes. The positions are defined
exhaustively per operation (a table in the language spec covers
all 18 structural operations). This invariant eliminates nested-
evaluation ambiguity — the kernel never needs to decide whether
a result needs another evaluation step.

### 4.5 Validation

Between compilation and evaluation, the IR is validated:

1. Every node conforms to the grammar (correct `tisyn`
   discriminant, required fields present and correctly typed).
2. Every structural Eval's `data` is a Quote.
3. No Quote node at any evaluation position (single-Quote rule).
4. Every Ref is bound by an enclosing Let or Fn (scope
   consistency).
5. Fn params are non-empty strings with no duplicates.
6. Malformed nodes (matching `tisyn` but missing fields) are
   errors, never treated as Literals.

Validation runs before evaluation begins. Invalid IR is rejected
with a diagnostic.

### 4.6 Related Work

Programs-as-data traces from **Lisp (1958)** through **free
monads** (computations as syntax trees with external handlers)
to **Unison's** content-addressed code. Tisyn's IR is
conceptually a free monad: the tree describes a computation,
the kernel provides the interpretation. Compared to Temporal,
which trusts the developer to be deterministic, Tisyn's tree
is deterministic by construction.

---

## 5. Kernel and Evaluation Model

### 5.1 The Kernel as Interpreter

The kernel implements a recursive evaluation function:

```
eval : (Expr, Env) → Val | Error | Suspend(EffectDescriptor)
```

The three-outcome signature makes the evaluator a coroutine: it
yields control at effect boundaries and resumes with results. In
implementation, the kernel is a JavaScript generator. `Suspend`
maps to `yield`. The Effection structured concurrency library
manages the generator's lifecycle.

### 5.2 The Environment

The kernel maintains an environment — a linked list of immutable
frames mapping names to values (Abelson and Sussman, SICP §3.2).
Immutability guarantees determinism (no mutation from concurrent
tasks or external events) and concurrency safety (child tasks
receive pointers to the same frame chain — no cloning, no
locking). Only Vals may enter the environment. Eval, Quote, and
Ref nodes must be fully evaluated before storage.

### 5.3 Two Data Preparation Functions

**`unquote(node, E)`** strips one Quote layer, returning raw Expr
fields. Used by structural operations to access their data
without evaluating it. The result may contain unevaluated
expressions that the operation evaluates selectively.

**`resolve(node, E)`** prepares standard external effect data by
resolving unquoted expression positions. Quoted payloads are
preserved as opaque data — nested IR nodes within quoted contents
are values by origin/context and are not traversed or evaluated.
Used exclusively at the external effect boundary for standard
(non-compound) effects. The **opaque value rule** ensures `resolve`
never re-enters values returned by `lookup` or `eval`, preventing
agent-returned data from being re-interpreted as code.

**Compound external operations** (`all`, `race`, `spawn`) use
`unquote` instead of `resolve`, preserving child expressions for
the execution layer to spawn as separate tasks.

Stream iteration uses the standard external path instead.
Compiled `for (const x of yield* each(expr))` loops lower to the
reserved effect IDs `stream.subscribe` and `stream.next`, which
flow through `resolve()` and the ordinary yield/journal boundary
while the runtime manages restricted subscription-handle values.

### 5.4 Call-Site Resolution

Tisyn functions have no closures. A `Fn` body evaluates in the
caller's environment extended with parameter bindings, not the
definer's environment. This is dynamic scoping for free variables.

This design enables two critical patterns:

1. **Recursive loops.** The compiler transforms while-with-return
   into a Fn that references itself via `Ref`, resolved in the
   caller's environment where the `Let` binding holds the Fn.

2. **Fn bodies with effects.** The `call` structural operation
   invokes `eval(F.body, E')`. If the body contains external Eval
   nodes, they cross the execution boundary normally — the kernel
   suspends and resumes transparently. This is what makes
   recursive loops and sub-workflow calls work with durable
   effects inside function bodies.

### 5.5 Related Work

**CESK machines** (Felleisen and Friedman, 1986): the kernel is
a CESK machine without the Store (no mutation) and with the
Kontinuation implicit in the generator stack. **Algebraic
effects** (Plotkin and Power, 2002; Plotkin and Pretnar, 2009):
external Eval nodes are effect operations; the execution layer
is the handler.

---

## 6. Effects and Journaling

### 6.1 Why Effects Are Externalized

In Tisyn, external interactions are effect declarations, not
function calls. The kernel yields a descriptor; the execution
layer decides what to do with it. The kernel does not know
whether a result came from an agent or from the journal. This is
the dependency inversion principle applied to I/O.

### 6.2 The Journal

The journal is an append-only sequence of events stored in a
Durable Stream. Two event types:

**Yield** — records an effect's description and result:

```json
{
  "type": "yield",
  "coroutineId": "root",
  "description": { "type": "order-service", "name": "fetchOrder" },
  "result": { "status": "ok", "value": { "id": "123", "total": 150 } }
}
```

**Close** — records a task's terminal state:

```json
{
  "type": "close",
  "coroutineId": "root",
  "result": { "status": "ok", "value": { "receiptId": "r-456" } }
}
```

**Event result** has three possible statuses:

- `{ status: "ok", value: Val }` — success
- `{ status: "err", error: { message, name? } }` — failure
- `{ status: "cancelled" }` — task was cancelled

### 6.3 Persist-Before-Resume

The most important invariant:

> A Yield event must be durably acknowledged before the kernel
> resumes with the result.

The kernel never sees a result that isn't in the journal. If the
host crashes after agent response but before journal write, the
effect is re-dispatched (at-least-once delivery). If it crashes
after journal write but before resume, replay feeds the stored
result.

This is **write-ahead logging** (Mohan et al., ARIES, 1992)
applied to workflow effects.

### 6.4 Durability Guarantees

Six guarantees define the journal's behavior:

**G1 — Persistence.** Acknowledged events survive crashes.

**G2 — Non-persistence.** Unacknowledged events may not persist.

**G3 — Persist-before-resume.** Yield acknowledged before kernel
resumes.

**G4 — Close-after-children.** Parent's Close after all
children's Closes.

**G5 — Causal ordering.** If event A depends on event B, B
precedes A in the stream.

**G6 — Single writer.** Epoch fencing ensures at most one host
instance writes to a stream at any time. If a host crashes and a
new host starts with a higher epoch, the old host's subsequent
writes are rejected (403 Forbidden).

### 6.5 Event Ordering

1. Events within a stream are totally ordered.
2. A child's Close precedes the parent's Yield consuming it.
3. Yields for a coroutine appear in yield order.
4. Close appears after all Yields for that coroutine.
5. Parent's Close appears after all children's Closes.

### 6.6 Cleanup Effects

When a task's scope is destroyed (completion, error, or
cancellation), `finally` blocks may yield effects. These cleanup
effects continue the same yield index sequence as normal effects
— the index does NOT reset. Cleanup effects use the same
correlation ID scheme and are journaled identically.

```
Task root.0:
  [0] yield agent.acquire ok            (id: "root.0:0")
  [1] yield agent.riskyOp err "boom"    (id: "root.0:1")
  [2] yield agent.release ok            (cleanup, id: "root.0:2")
  [3] close root.0 err "boom"
```

The ReplayIndex does not distinguish cleanup effects from normal
effects. On replay, cleanup effects replay from journal like any
other. Cleanup effects during cancellation are best-effort — if
they complete before the parent's teardown, they are journaled.

### 6.7 Related Work

**Event sourcing** (Fowler, 2005): state reconstructed from
event replay. **Kafka** (2011): append-only commit log. Tisyn's
journal is conceptually similar but per-workflow, not distributed.

---

## 7. Deterministic Replay

### 7.1 What Determinism Means

Given the same IR tree, arguments, effect result sequence, and
classification function, the kernel produces the same effect
descriptors, final value, and task tree. This is execution
determinism conditioned on effect results — not global
determinism, since agents may return different values on
re-dispatch.

### 7.2 How Replay Works

On restart after a crash:

```
1. Read journal from Durable Stream.
2. Build ReplayIndex: per-coroutine arrays of (description, result)
   with cursor positions.
3. Create fresh evaluation from the IR tree.
4. Evaluate. At each external Eval:
   a. Check ReplayIndex for the coroutine's current cursor.
   b. If entry exists → compare description.
      Match compares ONLY type and name (not arguments).
      If match: return stored result synchronously (REPLAY).
      If mismatch: DIVERGENCE error.
   c. If no entry and no Close: dispatch to agent (LIVE — transition).
   d. If no entry but Close exists: DIVERGENCE error.
```

**Description matching** compares only `type` and `name`, not
arguments. This allows argument values to change between code
versions without breaking replay of in-flight workflows — as
long as the effect identity (which agent, which method) remains
the same.

Replay is synchronous: stored results are fed to the kernel
without I/O. After replay, the kernel reaches the first
un-journaled effect and transitions to live execution.

**Divergence** means the replayed code produces a different
effect sequence than the stored journal. Divergence is fatal:
the kernel halts. Partial replay with mismatched effects is
indistinguishable from data corruption.

### 7.3 Structural Determinism

The IR provides determinism structurally. The types that cause
nondeterminism in JavaScript simply don't exist in the IR:

- No `Math.random()` — no random number primitive
- No `Date.now()` — no time primitive (time is an effect)
- No `Map`/`Set` iteration — no Map/Set types
- No `for...in` — no property enumeration
- No `Symbol` — no non-string keys
- No async scheduling — kernel is synchronous between effects

Additional structural guarantees:

- `construct` evaluates fields in lexicographic key order,
  ensuring identical effect ordering across languages.
- Arithmetic and comparison operators are numeric-only.
- `and`/`or` return operand values, not booleans.
- `eq` uses canonical encoding (lexicographic key sort) for
  structural comparison of complex values.

### 7.4 Canonical Encoding

For byte-equal comparison of IR trees, journal events, and
values, the system defines a canonical JSON encoding:
lexicographic key sorting at every nesting level, no whitespace,
numbers in shortest round-trip form. All implementations must
use IEEE 754 binary64 for numeric computation and JSON number
parsing.

Canonical encoding is used for `eq` comparison, interoperability
testing, and hashing. Wire messages and journal storage may use
non-canonical encoding.

### 7.5 Related Work

**Temporal** (2020): replays functions with injected results.
**Restate** (2023): bidirectional journal protocol. **Azure
Durable Functions** (2017): history-table replay. All share
persist-before-resume; they differ in execution model.

---

## 8. Concurrency Model

### 8.1 Structured Concurrency

Tisyn uses structured concurrency (Smith, 2018): every child has
a parent, no child outlives its parent, cancellation propagates
downward. Concurrency is not a language feature — it is an
execution-layer interpretation of specific effect descriptors.

### 8.2 `all` and `race`

**`all`:** Spawn N child tasks, each evaluating one expression.
Wait for all to complete. Return results in expression order (not
completion order). If any child fails, cancel the rest and
propagate the error.

**`race`:** Spawn N child tasks. Return the first to complete
successfully. Cancel the rest. A failing child does not win — the
race continues with remaining children. If all fail, propagate
the last error. Return value is the winner's result (not an
array).

### 8.3 Why Concurrency Is External

Concurrency is external to the IR (not a structural operation)
for two reasons:

1. **Single-threaded evaluator.** The kernel never has two things
   executing simultaneously. No race conditions in evaluation.
2. **Journal interaction.** Each child task produces its own Yield
   events with its own coroutine ID. The execution layer manages
   ID assignment, per-coroutine cursors, and cancellation
   coordination. Embedding this in the evaluator would couple
   evaluation rules with journaling logic.

The **compound external exception** enables this: `unquote` (not
`resolve`) preserves child expressions. Each child receives the
parent's immutable environment — a pointer copy, no cloning.

### 8.4 Related Work

**Nurseries** (Trio, Smith, 2018): `all` is semantically a
nursery with N children. **Fork/join** (Cilk, 1995): `all` is
join-all; `race` is join-any.

---

## 9. Agent Model

### 9.1 Agents as Effect Handlers

Agents are handlers for external effects. They receive JSON,
perform work, return JSON. They have no knowledge of journals,
replay, task structure, or the IR. They can be written in any
language with JSON-RPC 2.0 support.

The `Agent()` primitive produces both client stubs (constructing
IR nodes or DurableEffect wrappers on the host) and
implementation registries (on the agent). One definition, two
roles — eliminating contract mismatches.

### 9.2 The Initialize Handshake

On connection, the agent declares itself:

- `agentId` — unique identifier matching the IR's dotted `Eval.id`
  prefix
- `capabilities.methods` — the list of operation names it handles
- `capabilities.concurrency` — max concurrent Execute requests
- `capabilities.progress` — whether it emits Progress
  notifications

The host validates compatibility and rejects agents with
incompatible protocol versions.

### 9.3 Idempotency and At-Least-Once Delivery

The system provides at-least-once delivery, not exactly-once.
Effects may execute more than once if the host crashes after
dispatch but before journaling. Agents must handle this via:

- **Natural idempotency** (read-only operations)
- **Deduplication** via the correlation ID — which is
  deterministic and stable across re-dispatches
- **Downstream idempotency keys** (e.g., Stripe's
  `idempotency_key`)

The agent is solely responsible for the correctness of external
side effects. The kernel does not enforce, validate, or roll back
side effects. Non-idempotent operations must implement a
mitigation strategy, documented per operation.

### 9.4 Two Error Categories

**Application errors** (`result.ok = false`) — the operation ran
but failed. These are journaled as Yield(err) events and
participate in replay. On replay, the same error is re-delivered.

**Protocol errors** (JSON-RPC `error` field) — the request was
malformed or the operation is unknown. These are NOT journaled.
They indicate bugs and cause task failure without a replay record.

### 9.5 Progress: Ephemeral Observation

Agents may emit Progress notifications during effect execution.
Progress is ephemeral: not journaled, not replayed, not
guaranteed to be delivered. It may be lost on disconnect. It
exists only for real-time observation of in-flight operations.

### 9.6 Related Work

Agents combine aspects of the **actor model** (Hewitt, 1973) —
isolated message-passing processes — with **RPC services** —
registered methods accepting serialized input. They are
stateless, unlike actors.

---

## 10. Error and Cancellation Flow

### 10.1 Error Propagation Across Layers

```
Agent error         → application error { ok:false, error:{message,name} }
                         ↓
Execution Layer     → writes Yield(err) to journal, awaits ack
                         ↓
Kernel              → receives error via resume path
                    → propagates upward through structural operations
                       (each operation stops, remaining sub-expressions skipped)
                    → if uncaught: reaches task boundary
                         ↓
Execution Layer     → writes Close(err) for the task
                    → if task is child of all: cancels siblings
                    → if task is child of race: race continues with rest
```

### 10.2 Cancellation Flow

Cancellation propagates downward (parent → children), never
upward:

```
Host decides to cancel root task
  ↓
Execution Layer sets root.cancelling = true   (point of no return)
  ↓
Cancel child root.1 (reverse creation order):
  root.1.cancelling = true
  Send Cancel to Agent B (best-effort, notification, no response expected)
  Destroy root.1's evaluation scope (generator.return(), finally blocks run)
  If finally blocks yield effects: journaled with continuing yield index
  Write Close(cancelled) for root.1
  ↓
Cancel child root.0:
  (same sequence)
  ↓
Destroy root's evaluation scope
Write Close(cancelled) for root
```

**Point-of-no-return.** Once `cancelling` is set, any agent
result for that task's pending effect is discarded. No Yield is
written. Cancellation is irrevocable.

**Cancellation is not an error.** It propagates via
`generator.return()` (not `throw()`), triggering `finally` blocks
for cleanup. A parent's `catch` does not catch cancellation.

**Cancel is best-effort.** The agent may not receive it (lost in
transit), may receive it after completing, or may take time to
stop. The host does not wait for acknowledgment.

---

## 11. Transport Layer

### 11.1 Transport Independence

The wire protocol (JSON-RPC 2.0) is transport-agnostic. Six
message types: Initialize, Execute, Result, Progress, Cancel,
Shutdown. Four transport bindings:

- **WebSocket:** Bidirectional, persistent. Natural fit for
  long-running workflows.
- **Stdio (NDJSON):** Newline-delimited JSON. For subprocess
  agents.
- **SSE + POST:** Works through HTTP proxies and load balancers.
- **In-process:** Direct object passing. For testing.

### 11.2 Transport Does Not Affect Semantics

Switching from WebSocket to stdio does not change the journal,
the evaluation path, the replay behavior, or the determinism
guarantees. The only observable differences are latency and
connection lifecycle behavior. All transports must deliver
messages in order per direction and deliver complete messages.

### 11.3 Reconnection

Reconnection is a fresh session — no protocol-level session
resumption. The agent sends Initialize again. The host
re-dispatches pending effects (same correlation IDs). This
simplicity is deliberate: session resumption adds protocol
complexity for marginal benefit, since the journal already
handles crash recovery.

---

## 12. The Compiler

### 12.1 What the Compiler Does

The compiler transforms TypeScript generator functions into Tisyn
IR. It accepts a restricted authoring subset (no mutation, no
nondeterministic APIs, no closures) and produces a Fn node — a
JSON document. The compilation is deterministic: same source →
byte-identical JSON.

### 12.2 Three `yield*` Cases

| Case         | Source                        | IR Output     | Data shape             |
| ------------ | ----------------------------- | ------------- | ---------------------- |
| Agent effect | `yield* Agent().method(args)` | External Eval | Unquoted array         |
| Concurrency  | `yield* all/race([...])`      | Compound Eval | Quoted `{exprs:[...]}` |
| Built-in     | `yield* sleep(ms)`            | External Eval | Unquoted array         |

The quoting difference is critical: agent effects use unquoted
data (resolved by `resolve()` at runtime), while concurrency
nodes use quoted data (preserved by `unquote()` for the execution
layer to spawn).

### 12.3 Control Flow Transformations

- **Sequential statements** → nested `let` chains
- **Early return** → code after `if`-with-return moves into
  the `else` branch
- **While without return** → `while` IR node directly
- **While with return** → recursive Fn + Call (the IR's `while`
  has no early-exit mechanism — the compiler transforms the
  loop into a Fn that calls itself, terminating when a branch
  produces a value instead of recursing; call-site resolution
  enables the self-reference)
- **Discarded effects** → `let` with synthetic discard name
  (preserving evaluation order) or `seq` when no bindings are
  referenced

---

## 13. Comparison to Existing Systems

| Aspect             | Async/retry    | Queues             | Temporal             | Tisyn                |
| ------------------ | -------------- | ------------------ | -------------------- | -------------------- |
| Crash recovery     | No             | Partial            | Full                 | Full                 |
| Determinism        | None           | None               | Developer discipline | Construction         |
| Workflow structure | Code           | Scattered          | Code                 | Serializable tree    |
| Effect isolation   | None           | Message boundaries | SDK boundary         | Eval nodes           |
| Concurrency        | Language-level | Consumer count     | SDK primitives       | `all`/`race`         |
| Inspection         | Debugger       | Queue monitoring   | Replay debugger      | Static tree analysis |
| Language lock-in   | Yes            | No                 | Per-SDK              | No (IR is JSON)      |
| Side-effect safety | None           | At-least-once/step | At-least-once        | At-least-once        |

The fundamental difference from Temporal: Temporal re-executes
native code with stored results; Tisyn evaluates a deterministic
tree with stored results. Temporal trusts the developer; Tisyn
trusts the compiler.

---

## 14. Design Trade-offs

**Verbosity vs determinism.** The IR is verbose. The verbosity
buys determinism, inspectability, and serializability. The
developer never sees the IR.

**No mutation.** Variables are bound once. No race conditions on
shared state, but loop patterns require recursion.

**Explicit control flow.** No implicit fallthrough, no
`break`/`continue`. The compiler restructures early returns as
nested `if`/`else` and while-with-return as recursive Fn + Call.

**Replay cost vs reliability.** Replay is linear in effect count.
Checkpointing is a future optimization.

**At-least-once, not exactly-once.** Effects may execute more
than once. Agents bear the idempotency responsibility. Exactly-
once is impossible in the general case (Fischer, Lynch, and
Paterson, 1985).

---

## 15. Future Directions

**Static analysis.** The IR is JSON — tools can verify scope
consistency, detect dead code, estimate effect counts, and
identify invariant loops without execution.

**Optimization.** Common sub-expression elimination, dead code
elimination, effect batching.

**Error recovery.** A `try/catch` structural operation, deferred
until its journal interaction semantics are resolved.

**Multi-language.** The IR is language-agnostic. Compilers in
other languages could produce the same JSON trees.

---

## References

- Abelson, H. and Sussman, G.J. _Structure and Interpretation of Computer Programs_, MIT Press, 1996.
- Blumofe, R.D. et al. "Cilk: An efficient multithreaded runtime system," PPoPP, 1995.
- Felleisen, M. and Friedman, D.P. "Control operators, the SECD machine, and the λ-calculus," 1986.
- Fischer, M.J., Lynch, N.A., and Paterson, M.S. "Impossibility of distributed consensus with one faulty process," JACM, 1985.
- Fowler, M. "Event Sourcing," 2005.
- Garcia-Molina, H. and Salem, K. "Sagas," SIGMOD, 1987.
- Hohpe, G. and Woolf, B. _Enterprise Integration Patterns_, Addison-Wesley, 2003.
- Mohan, C. et al. "ARIES: A transaction recovery method," TODS, 1992.
- Plotkin, G.D. and Power, J. "Notions of computation determine monads," FoSSaCS, 2002.
- Plotkin, G.D. and Pretnar, M. "Handlers of algebraic effects," ESOP, 2009.
- Smith, N.J. "Notes on structured concurrency," 2018.
- Temporal. https://temporal.io
- Restate. https://restate.dev
- Unison. https://unison-lang.org
- Effection. https://frontside.com/effection
