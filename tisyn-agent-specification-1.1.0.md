# Tisyn Agent Implementation Specification

**Version:** 1.1.0
**Complements:** Tisyn Kernel Specification 1.0.0
**Status:** Normative

---

## 1. Agent Role

### 1.1 What an Agent Is

An agent is a process that executes operations on behalf of the
Tisyn kernel. It receives effect descriptors, performs work, and
returns results. An agent is the system's interface to the
outside world.

### 1.2 Responsibilities

- Receiving Execute requests from the host.
- Looking up the requested operation in its registry.
- Executing the operation with the provided arguments.
- Returning exactly one Result per Execute request.
- Handling cancellation signals by stopping work.
- Tolerating duplicate execution of the same operation.

### 1.3 NOT Responsible For

- **Journaling.** The kernel writes journal events. The agent
  MUST NOT attempt to read, write, or influence the journal.
- **Replay.** The kernel decides whether to dispatch or replay.
  The agent does not know which. A request received during
  replay is indistinguishable from a live request.
- **Task management.** No knowledge of parent/child, task IDs,
  or coroutine structure.
- **Ordering.** The kernel manages effect sequencing.
- **Durability.** The kernel persists results in the journal.

### 1.4 Side-Effect Responsibility

> The agent is solely responsible for the correctness of
> external side effects it produces. The kernel does not
> enforce, validate, observe, or roll back side effects.

If an agent writes to a database, sends an email, or charges
a credit card, and the operation subsequently fails or is
cancelled, the kernel records the failure but does NOT undo
the side effect. The agent MUST manage its own transactional
boundaries, compensations, and cleanup.

### 1.5 Agent Identity

```
agentId: string   // MUST match [a-z][a-z0-9-]*, MUST NOT contain dots
```

Matches the prefix of dotted Eval `id` strings in the IR.
Agent `"order-service"` handles effects with `id` starting
with `"order-service."`.

---

## 2. Operation Registration

### 2.1 Operation Identity

An operation is identified by `(agentId, operationName)`. On
the wire, the host sends `operationName` in Execute's
`operation` field.

```
Wire:  { "operation": "fraudCheck" }
Agent: registry["fraudCheck"] → handler
```

Operation names MUST match `[a-zA-Z][a-zA-Z0-9]*`. MUST NOT
contain dots.

### 2.2 The Registry

```
Registry = Map<string, Handler>
Handler : (args: Val[]) → Val | Error
```

Populated at startup. MUST NOT change during the agent's
lifetime. Adding or removing operations requires restarting
the agent and re-initializing.

### 2.3 Unknown Operations

If `operation` is not in the registry, the agent MUST respond
with a protocol error:

```json
{ "jsonrpc":"2.0", "id":"root:0",
  "error": { "code": -32601, "message": "Unknown operation: unknownMethod" } }
```

The agent MUST NOT silently ignore unknown operations. It MUST
NOT return an application error for this case — unknown
operations are protocol-level failures.

---

## 3. Execution Contract

### 3.1 Input

```json
{ "jsonrpc":"2.0", "id":"root.0:2", "method":"execute",
  "params": {
    "executionId": "ex-abc-123", "taskId": "root.0",
    "operation": "fraudCheck",
    "args": [{ "id": "order-123", "total": 150 }],
    "progressToken": "root.0:2",
    "deadline": "2026-03-19T12:05:00Z" }}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Correlation ID (see §3.2) |
| `executionId` | string | Yes | Workflow execution instance |
| `taskId` | string | Yes | Coroutine ID |
| `operation` | string | Yes | Operation name |
| `args` | Val[] | Yes | JSON arguments (always an array) |
| `progressToken` | string | No | For progress notifications |
| `deadline` | string | No | ISO 8601 absolute deadline |

### 3.2 Correlation ID Semantics

The `id` field is the **correlation ID**. It has the format
`"{taskId}:{yieldIndex}"` and is the primary identifier for
matching requests to responses.

**Stability guarantee.** The correlation ID is deterministic.
The same effect in the same workflow execution always produces
the same correlation ID, even across:

- Host restarts
- Transport reconnections
- Re-dispatches after crash

This stability makes the correlation ID the correct key for
deduplication (§4). When the host re-dispatches an effect after
crash, it sends an Execute with the **same** `id` as the
original dispatch.

**Uniqueness guarantee.** Within a single execution
(`executionId`), each correlation ID is unique. No two Execute
requests from the same execution will have the same `id` unless
one is a re-dispatch of the other.

### 3.3 Output

**Success:**

```json
{ "jsonrpc":"2.0", "id":"root.0:2",
  "result": { "ok": true, "value": true } }
```

**Application error:**

```json
{ "jsonrpc":"2.0", "id":"root.0:2",
  "result": { "ok": false,
    "error": { "message": "service unavailable", "name": "ServiceError" } } }
```

**Protocol error:**

```json
{ "jsonrpc":"2.0", "id":"root.0:2",
  "error": { "code": -32601, "message": "Unknown operation" } }
```

The response `id` MUST match the request `id`.

### 3.4 Exactly One Response

The agent MUST send exactly one response per Execute request.

- Zero responses: the host will time out and MAY re-dispatch
  the effect, cancel the task, or fail the workflow. The
  timeout behavior is host-configured, not agent-controlled.
- Multiple responses: the host discards all responses after the
  first. The agent MUST NOT rely on the host processing a
  second response.

### 3.5 No Streaming

An operation returns a single result. There is no streaming
response mechanism. Use Progress (§10) for intermediate updates
and a single Result for the final value.

### 3.6 Result Constraints

The `value` field MUST be a valid Val:

- JSON primitives (string, number, boolean, null)
- JSON arrays (containing only valid Vals)
- JSON objects (containing only valid Vals as values)
- Objects with `tisyn` fields are valid — they are opaque data
  from the agent's perspective, not IR nodes

The `value` field MUST NOT contain: `undefined`, `NaN`,
`Infinity`, `-Infinity`, functions, class instances, `Symbol`,
`BigInt`, `Date` objects, `RegExp`, `Map`, `Set`, circular
structures, `ArrayBuffer`, or `TypedArray`.

If `value` is absent when `ok` is `true`, it is treated as
`null`.

### 3.7 Deadline Semantics

If `deadline` is present:

- The agent SHOULD attempt to complete before it.
- If the agent determines the deadline will be or has been
  exceeded, it SHOULD return an application error:
  `{ ok: false, error: { message: "deadline exceeded", name: "DeadlineExceeded" } }`
- The agent MUST NOT silently ignore deadlines indefinitely.
  It SHOULD implement a check, even if approximate.

If `deadline` is absent, there is no time constraint from the
host. The agent MAY still impose its own internal timeout.

The host MAY independently cancel requests that exceed
deadlines. The agent MAY receive a Cancel (§5) after a deadline
passes, whether or not it has sent a Result.

Deadline enforcement is **best-effort on both sides.** Neither
the agent nor the host guarantees precise deadline adherence.

---

## 4. Idempotency

### 4.1 At-Least-Once Dispatch

The kernel guarantees at-least-once dispatch, NOT exactly-once.
An effect MAY be dispatched to the agent more than once because:

- The host crashed after dispatching but before writing the
  Yield event to the journal.
- The transport dropped after the agent sent the Result but
  before the host received it.
- The host timed out and re-dispatched.

**The agent MUST tolerate at-least-once execution.** This is not
optional. It is a fundamental property of the system.

When a duplicate Execute arrives, it will have the **same
correlation ID** (`id` field), the same `executionId`, the same
`taskId`, and the same `args`. The correlation ID is the
primary key for detecting duplicates.

### 4.2 Three Strategies

Every operation MUST use one of the following strategies:

**Strategy A — Naturally idempotent.** The operation produces
the same observable result regardless of execution count.
Executing it twice has the same external effect as executing
it once. Examples: read-only queries, pure computations,
HTTP GET requests, lookups by ID.

**Strategy B — Deduplication.** The agent tracks which
correlation IDs it has already processed and returns the stored
result for duplicates:

```
key = executionId + ":" + correlationId
if key in dedup_store:
  return dedup_store[key]
else:
  result = execute_operation(args)
  dedup_store[key] = result
  return result
```

The correlation ID is **stable across re-dispatches** — the
same effect always produces the same ID. This is what makes
deduplication reliable.

The dedup store MUST persist across agent restarts (database,
cache with TTL). An in-memory-only store loses entries on agent
restart, which is precisely when re-dispatches occur.

**Strategy C — Idempotency keys.** The operation's arguments
include a key that the downstream service uses for
deduplication. The agent passes the key through:

```typescript
*chargeCard(payment, idempotencyKey): Operation<Receipt> {
  return yield* call(() =>
    stripe.charges.create({
      ...payment,
      idempotency_key: idempotencyKey
    }));
}
```

The workflow provides a deterministic key (derived from order
ID, execution ID, etc.). The downstream service deduplicates.

### 4.3 Non-Idempotent Operations

Operations with side effects that are NOT safe under retry
MUST use Strategy B or C. Examples:

- Sending an email (duplicate sends are visible to the user)
- Incrementing a counter (duplicate increments corrupt data)
- Creating a record without a dedup key (duplicates created)
- Triggering a webhook (duplicate triggers confuse receivers)

If an operation cannot implement any strategy (no dedup store
available, no idempotency key supported by the downstream
service), this limitation MUST be documented. The workflow
developer MUST account for it — for example, by treating the
operation as best-effort and handling duplicate side effects
in the business logic.

### 4.4 Documentation Requirement

Each agent MUST document, for every operation:

1. Whether the operation is naturally idempotent (Strategy A).
2. If not, which mitigation strategy is used (B or C).
3. Any conditions under which idempotency breaks (e.g., dedup
   store TTL expired, downstream service does not honor key).
4. What side effects the operation produces and whether they
   are safe under retry.

---

## 5. Cancellation

### 5.1 Delivery

```json
{ "jsonrpc":"2.0", "method":"cancel",
  "params": { "id": "root.0:2", "reason": "parent_cancelled" } }
```

Cancel is a JSON-RPC **notification** — no `id` field at the
JSON-RPC level, no response expected. `params.id` is the
correlation ID of the Execute being cancelled. `reason` is
optional and human-readable.

### 5.2 Best-Effort Semantics

Cancellation is **best-effort, not guaranteed.** The agent
SHOULD:

1. Look up the in-flight operation by correlation ID.
2. Stop ongoing work (abort HTTP requests, close database
   cursors, release resources).
3. NOT send a Result for the cancelled operation.

The agent MAY:

- Ignore the Cancel if the operation has already completed
  and a Result was already sent.
- Take a reasonable amount of time to clean up before
  ceasing work.

The agent MUST NOT:

- Crash or enter an error state due to a Cancel.
- Treat Cancel as a protocol error.
- Send an error response to the Cancel notification.

### 5.3 Cancel Racing with Completion

When cancellation races with operation completion, two outcomes
are possible:

**Agent completes first.** The agent sends a Result before
receiving the Cancel (or ignoring it because the operation is
done). The host receives the Result. Whether the host uses it
depends on the host's internal state — if the host has already
set the task's `cancelling` flag, it discards the Result.

**Cancel arrives first.** The agent receives the Cancel before
completing. The agent stops work and does not send a Result.
The host writes Close(cancelled) for the task.

In both cases, the agent's behavior is correct. The agent does
not need to know which outcome the host chose. The agent's
obligation is: attempt to stop work on Cancel, and send at most
one Result per Execute.

### 5.4 Late Results

If the agent sends a Result after the host has cancelled the
task (host set `cancelling = true`, wrote Close(cancelled)),
the host silently discards the Result. No Yield event is written.
This is normal operation, not an error. The agent does not
receive any indication that its Result was discarded.

### 5.5 Cancel for Unknown Correlation ID

If the agent receives a Cancel with a correlation ID it does not
recognize (e.g., the Execute was processed on a previous
connection, or the Cancel arrived before the Execute due to
transport reordering), the agent MUST silently discard the
Cancel. It MUST NOT treat this as an error.

### 5.6 Cancel + Re-dispatch

If a cancelled operation is re-dispatched after a host crash,
the agent receives a fresh Execute with the same correlation ID
as before. The agent MUST execute it normally — it MUST NOT
refuse because it previously received a Cancel for that ID.

---

## 6. Concurrency

### 6.1 Declaration

```json
{ "capabilities": { "concurrency": 10 } }
```

The agent declares the maximum number of Execute requests it
can process simultaneously on a single connection. Default: 1.

### 6.2 Host Obligation

The host MUST NOT send more concurrent Execute requests than
the agent's declared concurrency limit. "Concurrent" means
Execute requests for which the host has not yet received a
Result.

### 6.3 Exceeding the Limit

If the agent receives more concurrent Execute requests than
its declared limit (host bug or race condition):

- The agent SHOULD reject the excess request with a protocol
  error: `{ "error": { "code": -32003, "message": "Concurrency limit exceeded" } }`
- The agent MAY queue the excess request and process it when
  a slot opens.
- The agent MUST NOT silently drop the request.
- The agent MUST NOT crash.

### 6.4 No Ordering Guarantees

When multiple Execute requests are in-flight simultaneously,
the agent MAY process and respond to them in any order. The
agent MUST NOT:

- Assume any ordering relationship between concurrent requests.
- Assume concurrent requests are related (they may be from
  different tasks, different workflows, or the same task).
- Block one request waiting for another's result.
- Deadlock due to ordering assumptions.
- Require a specific completion order.

The agent MAY: execute requests in parallel, queue and execute
sequentially, or mix strategies.

---

## 7. Error Handling

### 7.1 Two Categories

Errors are strictly divided into two categories with different
lifecycle implications:

**Application errors** — the operation ran (or attempted to run)
but could not produce a successful result. These are returned
via `result.ok = false`. The host **journals** application
errors as Yield(err) events. They **participate in replay** —
on replay, the same error is delivered to the kernel.

**Protocol errors** — the request was malformed, the operation
is unknown, or the agent is misconfigured. These are returned
via the JSON-RPC `error` field. The host does NOT journal
protocol errors. They indicate bugs or misconfiguration and
cause the task to fail without a replay record.

### 7.2 Classification Rules

| Situation | Category | Reason |
|-----------|----------|--------|
| Database query failed | Application | Operation attempted, infrastructure failed |
| External API returned 500 | Application | Operation attempted, dependency failed |
| Input validation failed | Application | Operation rejected input |
| Timeout waiting for response | Application | Operation could not complete in time |
| Business rule violation | Application | Operation logic rejected request |
| Unknown operation name | Protocol | Agent misconfigured or host sent wrong name |
| Missing required field | Protocol | Malformed Execute message |
| Invalid JSON | Protocol | Transport or serialization bug |
| Agent not initialized | Protocol | Lifecycle violation |

**Rule of thumb:** if the operation handler was invoked, the
error is application. If the error occurred before the handler
could be invoked, it is protocol.

### 7.3 Error Structure

```typescript
interface ApplicationError {
  message: string;    // MUST be non-empty
  name?: string;      // SHOULD be CamelCase error class name
}
```

Both fields MUST be strings. `message` MUST be non-empty.
`name` is optional and is used for programmatic error
classification on the host side.

The error object MUST NOT contain additional fields beyond
`message` and `name`. Agents that need to convey structured
error data SHOULD encode it in the `message` string.

### 7.4 Unhandled Exceptions

If the operation handler throws an uncaught exception, the
agent runtime MUST catch it and convert to an application error:

```json
{ "ok": false, "error": { "message": "Internal error: <exception message>", "name": "InternalError" } }
```

The agent MUST NOT crash due to an unhandled exception in an
operation handler. It MUST remain available for subsequent
requests on the same connection.

### 7.5 Partial Failure and Side Effects

If the operation partially completed before failing (e.g.,
wrote to a database then failed on a subsequent step):

1. The agent returns an application error.
2. The host records a Yield(err) event.
3. The committed side effects **are not rolled back** by the
   kernel. The kernel has no mechanism for rollback.
4. If the effect is re-dispatched (crash + retry), the agent
   receives the same request. Its idempotency strategy (§4)
   MUST handle the partially-completed state.

---

## 8. Serialization Contract

### 8.1 JSON Only

All data crossing the agent boundary MUST be JSON-serializable
per RFC 8259. This applies to:

- `args` (host → agent)
- `result.value` (agent → host)
- `result.error` (agent → host)
- `progress.value` (agent → host)

### 8.2 Prohibited Values

The following MUST NOT appear in any data crossing the boundary:

`undefined`, `NaN`, `Infinity`, `-Infinity`, functions, class
instances, `Symbol`, `BigInt`, `Date` (serializes lossily),
`RegExp` (serializes to `{}`), `Map`, `Set`, `WeakMap`,
`WeakSet`, `ArrayBuffer`, `TypedArray`, circular structures.

The agent MUST validate that its return values satisfy this
constraint. A value that passes `JSON.parse(JSON.stringify(v))`
without change satisfies the constraint.

### 8.3 Numbers

All numbers MUST be IEEE 754 binary64. Integers are exact up
to 2^53 - 1. The agent MUST NOT return numbers requiring
greater precision (use strings for large IDs, BigDecimal
amounts, etc.).

### 8.4 Opaque Arguments

Arguments MAY contain objects with `tisyn` fields. These are
**opaque data**, not IR nodes. The agent MUST:

- Treat all arguments as plain JSON data.
- NOT interpret `tisyn` fields as evaluation instructions.
- NOT attempt to evaluate, execute, or dispatch based on
  `tisyn` field values.
- NOT modify, strip, or rename `tisyn` fields.

An agent that wishes to interpret Fn nodes (as a Tisyn
evaluator) MAY do so, but this is opt-in behavior outside
the standard agent contract.

---

## 9. Reconnect and Duplicates

### 9.1 Fresh Session on Reconnect

If the transport connection drops and the agent reconnects,
it MUST send Initialize again. There is no session resumption
at the protocol level.

The host re-dispatches all effects that were pending on the
lost connection. The re-dispatched Execute requests have the
**same correlation IDs** as the original dispatches.

### 9.2 Duplicate Execution

The agent MAY receive an Execute with the same correlation ID
as a request it already processed (on the current or a previous
connection). The agent MUST handle this per §4 (idempotency).

If the agent uses Strategy B (deduplication), it looks up the
correlation ID in its dedup store. If found, it returns the
stored result without re-executing. If not found (store expired,
agent restarted without persistent store), it re-executes.

### 9.3 Stale Connections

The host MAY close connections it considers stale (agent
unresponsive, heartbeat missed). The agent MUST NOT assume
connection longevity. Long-running operations SHOULD:

- Implement internal checkpointing.
- Use keep-alive mechanisms if the transport supports them.
- Be prepared for abrupt disconnection.

### 9.4 Multiple Instances

Multiple agent instances with the same `agentId` MAY connect
simultaneously. The host load-balances Execute requests across
connections. The host MUST NOT send the same correlation ID to
multiple connections simultaneously.

If one instance disconnects, its pending effects are
re-dispatched to a remaining instance (which may receive a
correlation ID it has never seen — this is normal, handle per
§4).

---

## 10. Progress Reporting

### 10.1 Capability Declaration

```json
{ "capabilities": { "progress": true } }
```

If `progress` is not declared or is `false`, the agent MUST NOT
send Progress notifications.

### 10.2 Message

```json
{ "jsonrpc":"2.0", "method":"progress",
  "params": { "token": "root.0:2",
    "value": { "phase": "downloading", "percent": 45 } } }
```

`token` MUST match the `progressToken` from the Execute request.
`value` is agent-defined JSON (any valid Val).

### 10.3 Durability and Replay

Progress notifications are **NOT durable**:

- They are NOT written to the journal.
- They are NOT replayed during crash recovery.
- They are NOT guaranteed to be delivered to observers.
- They MAY be lost if the transport disconnects.
- They MAY be lost if no observer is connected.

Progress is ephemeral. It exists only for real-time observation
of in-flight operations.

### 10.4 Ordering

Progress notifications for a single token are delivered in the
order the agent sent them, within a single connection. If the
connection drops and reconnects, progress from the previous
connection is lost — there is no replay of missed progress.

There is no ordering guarantee between progress from different
tokens (different operations).

### 10.5 Lifecycle

Progress is valid only between Execute dispatch and Result
response:

```
Execute sent → [progress valid] → Result received
```

Progress sent after the Result is silently discarded by the
host. Progress sent after a Cancel is silently discarded.

### 10.6 No Token = No Progress

If the Execute request has no `progressToken` (field absent or
`null`), the agent MUST NOT send Progress notifications for
that request.

---

## 11. Implementation Guide

### 11.1 Minimal Agent

1. Connect to host.
2. Send Initialize with `agentId` and `capabilities`.
3. Receive Execute → look up `operation` → call handler →
   send Result.
4. Handle Cancel by aborting in-flight work.
5. On Shutdown, complete or cancel in-flight work and close.

### 11.2 Effection Runtime

Operations are Effection generators. Agent runtime creates an
Effection scope per operation:

```typescript
async function handleExecute(msg: ExecuteMessage) {
  const handler = registry[msg.params.operation];
  if (!handler) return protocolError(-32601);
  const scope = createScope();
  activeScopesByCorrelationId.set(msg.id, scope);
  try {
    const value = await scope.run(() =>
      handler(...msg.params.args));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: {
      message: error.message, name: error.name } };
  } finally {
    activeScopesByCorrelationId.delete(msg.id);
  }
}
```

Cancel destroys the scope:

```typescript
function handleCancel(msg: CancelMessage) {
  const scope = activeScopesByCorrelationId.get(msg.params.id);
  if (scope) scope.destroy();
  // No response. Silently ignore if not found.
}
```

### 11.3 Internal `yield*`

Inside operations, `yield*` is Effection structured concurrency
— NOT durable, NOT journaled. From the kernel's perspective,
the entire operation is one atomic effect. One Yield event
covers the whole operation, regardless of how many internal
`yield*` calls occur.

### 11.4 Agent-Side Validation

The agent SHOULD validate arguments before executing:

```typescript
*fraudCheck(order: Order): Operation<boolean> {
  if (!order || typeof order.total !== 'number')
    throw new Error("Invalid order: missing or non-numeric total");
  // ... execute
}
```

Validation failures become application errors (§7.4).

---

## 12. Transport Bindings

### 12.1 Supported

| Binding | Framing | Direction |
|---------|---------|-----------|
| WebSocket | WS messages | Bidirectional |
| Stdio | NDJSON | Bidirectional |
| SSE + POST | SSE↓ POST↑ | Asymmetric |
| In-process | Object passing | Bidirectional |

### 12.2 Requirements

All transports MUST:

- Deliver messages in order per direction.
- Deliver complete messages (no partial JSON).
- Support the full message catalog (Initialize, Execute,
  Result, Progress, Cancel, Shutdown).

---

## 13. Conformance Checklist

| # | Requirement | § |
|---|-------------|---|
| 1 | Initialize as first message | 3.1 |
| 2 | Declare `agentId` and capabilities | 1.5, 6.1 |
| 3 | Exactly one Result per Execute | 3.4 |
| 4 | Protocol error for unknown operations | 2.3 |
| 5 | Result values are JSON-serializable | 3.6 |
| 6 | Tolerate duplicate Execute (at-least-once) | 4.1 |
| 7 | Handle Cancel best-effort | 5.2 |
| 8 | No crash on Cancel for unknown ID | 5.5 |
| 9 | No crash on unhandled exception | 7.4 |
| 10 | Respect declared concurrency limit | 6.1 |
| 11 | Progress only when declared + token | 10.1, 10.6 |
| 12 | Initialize on reconnect (fresh session) | 9.1 |
| 13 | Treat arguments as opaque JSON | 8.4 |
| 14 | Document idempotency per operation | 4.4 |
| 15 | Handle Shutdown gracefully | 11.1 |
| 16 | Side effects are agent's responsibility | 1.4 |
| 17 | Do not interpret `tisyn` fields | 8.4 |
| 18 | Application vs protocol error distinction | 7.1 |
