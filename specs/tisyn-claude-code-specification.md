# Tisyn Claude Code Specification

**Version:** 0.1.0
**Package:** @tisyn/claude-code
**Depends on:** Tisyn Agent Specification, Tisyn Transport
Specification, Tisyn Protocol Specification
**Status:** Draft

---

### Changelog

**v0.1.0** — Initial release documenting the transport adapter
layer. Covers `createBinding` and `createSdkBinding` public
API, five declared agent operations (newSession, closeSession,
plan, fork, openFork), ACP protocol translation, parameter
unwrapping, progress forwarding, transport-level protocol
handling, transport lifecycle, subprocess diagnostics, SDK
adapter handle model, and error handling.

---

## 1. Overview

This specification defines the `@tisyn/claude-code` transport
adapter layer. The package connects Tisyn workflows to Claude
Code through two binding implementations:

1. An **ACP stdio adapter** (`createBinding`) that spawns a
   Claude Code ACP subprocess, translates between Tisyn
   protocol messages and ACP JSON-RPC, and manages subprocess
   lifecycle.

2. An **SDK adapter** (`createSdkBinding`) that wraps the
   `@anthropic-ai/claude-agent-sdk` TypeScript API, manages
   adapter-internal session handles, and translates between
   Tisyn protocol messages and SDK method calls.

Both adapters produce `LocalAgentBinding` values consumed by
`installRemoteAgent()`. The agent contract declares five
operations: `newSession`, `closeSession`, `plan`, `fork`, and
`openFork`.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- the `createBinding` and `createSdkBinding` public API
- the five declared agent operations and their behavior in
  both adapters
- operation name resolution and parameter unwrapping
- ACP protocol translation (pure translation functions)
- transport-level protocol handling (initialize, shutdown,
  cancel)
- progress forwarding from both adapter paths
- ACP transport lifecycle and subprocess diagnostics
- SDK adapter-internal handle model
- error handling across both adapters
- the conformance observable boundary

### 1.3 What This Specification Does Not Cover

- an authored workflow surface (`ClaudeCode().open(...)`,
  execution handles, `supervise(...)`)
- compiler lowering or static diagnostics
- journal/replay semantics (these belong to the kernel/runtime
  specifications)
- single-slot enforcement or concurrent-plan rejection
- event delivery, buffering, or supervision
- Claude Code product behavior beyond protocol compliance

### 1.4 Relationship to Other Specifications

This specification depends on the transport specification for
`LocalAgentBinding` and `AgentTransportFactory`. It depends on
the protocol specification for message constructors
(`executeSuccess`, `executeApplicationError`,
`progressNotification`, `initializeResponse`). It depends on
the agent specification for `agent()` and `operation()`
declarations.

It does not amend the kernel or compiler specifications.

## 2. Terminology

**ACP** — Agent Communication Protocol. A JSON-RPC 2.0 based
protocol used by Claude Code's stdio interface. Messages are
newline-delimited JSON (NDJSON) over stdin/stdout.

**LocalAgentBinding** — A Tisyn transport type that provides a
`transport()` method returning an Effection resource. The
resource exposes `send(message)` and `receive` (a channel of
agent-to-host messages).

**Session handle** — A `SessionHandle` value (`{ sessionId }`)
returned by `newSession` and `openFork`. Passed back to
`closeSession`, `plan`, and `fork` to identify which session
to operate on.

**Adapter-internal handle** — In the SDK adapter, an opaque
string like `"cc-1"`, `"cc-2"` that the workflow sees. The
real SDK session ID is never exposed.

**Parameter envelope** — The Tisyn compiler wraps each
operation's single parameter under the authored parameter name
(e.g. `plan(args: {...})` compiles to `{ args: { session,
prompt } }`). The adapter strips this envelope before sending
to ACP or dispatching to the SDK.

**Unwrap key** — The per-operation key used to strip the
parameter envelope. See §4.2.

## 3. Public API

### 3.1 createBinding

```typescript
function createBinding(config?: AcpAdapterConfig): LocalAgentBinding
```

Creates a `LocalAgentBinding` backed by the ACP stdio adapter.

**AcpAdapterConfig fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| command | string | `"claude"` | Command to spawn the ACP process |
| arguments | string[] | `["--acp"]` | Arguments for the command |
| env | Record<string, string> | (inherited) | Environment variables for the subprocess |
| cwd | string | (inherited) | Working directory for the subprocess |

The binding synthesizes the Tisyn initialize handshake
internally — ACP processes do not speak Tisyn protocol.

### 3.2 createSdkBinding

```typescript
function createSdkBinding(config?: SdkAdapterConfig): LocalAgentBinding
```

Creates a `LocalAgentBinding` backed by the Claude Agent SDK.

**SdkAdapterConfig fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| model | string | `"claude-sonnet-4-6"` | Model to use for session creation |
| permissionMode | string | (SDK default) | Permission mode (e.g. `"default"`, `"plan"`) |

Unlike the ACP adapter, the SDK adapter does not spawn a
subprocess directly — the SDK manages Claude Code subprocess
lifecycle internally.

### 3.3 Exported Types

```typescript
interface SessionHandle {
  sessionId: string;
}

interface PlanResult {
  response: string;
  toolResults?: Array<{ tool: string; output: unknown }>;
}

interface ForkData {
  parentSessionId: string;
  forkId: string;
}
```

The package also re-exports `AcpAdapterConfig` and
`SdkAdapterConfig`.

## 4. Declared Operations

The agent contract declares exactly five operations. These are
dispatched through `message.method === "execute"` in both
adapters.

### 4.1 Operation Table

| Operation | ACP wire method | Unwrap key | Returns |
|-----------|-----------------|------------|---------|
| newSession | session/new | config | SessionHandle |
| closeSession | session/close | handle | null |
| plan | session/prompt | args | PlanResult |
| fork | session/fork | session | ForkData |
| openFork | session/fork | data | SessionHandle |

Note: `fork` and `openFork` both map to the ACP wire method
`session/fork`. They are distinguished by their unwrap key and
the shape of their parameters.

### 4.2 Parameter Unwrapping

The Tisyn compiler wraps each operation's single parameter
under the authored parameter name. For example,
`plan(args: {...})` compiles to `{ args: { session, prompt } }`.
ACP expects unwrapped top-level params, so the adapter MUST
strip the envelope before writing to the wire.

The per-operation unwrap keys are:

| Operation | Unwrap key |
|-----------|------------|
| newSession | config |
| closeSession | handle |
| plan | args |
| fork | session |
| openFork | data |

**Unwrap rule:** If the unwrap key is present as a property of
the args object, its value MUST be used as the ACP params (or
SDK operation input). Otherwise the args object MUST be passed
through as-is. This keeps the adapter resilient to
already-unwrapped payloads.

Both adapters implement this unwrap logic independently: the
ACP adapter uses the `OPERATION_UNWRAP_KEY` lookup table, and
the SDK adapter uses an inline `UNWRAP` table.

### 4.3 Operation Name Resolution

Operation names MAY arrive fully qualified (e.g.
`"claude-code.newSession"`) or bare (e.g. `"newSession"`).
The adapter MUST strip the agent prefix before lookup.

If the bare name does not match any known operation, the
adapter MUST throw an error with a descriptive message listing
all known operations.

### 4.4 newSession

Creates a new Claude Code session.

**ACP adapter:** Translates to an ACP `session/new` request.
The ACP process creates the session and returns the session
handle.

**SDK adapter:** Calls `unstable_v2_createSession()` with the
configured model and optional `permissionMode`. Generates an
adapter-internal handle (see §8) and stores the SDK session
object. Returns `{ sessionId: handle }` where `handle` is the
adapter-internal handle (e.g. `"cc-1"`).

### 4.5 closeSession

Releases an existing session.

**ACP adapter:** Translates to an ACP `session/close` request.

**SDK adapter:** Looks up the session by adapter handle, calls
`session.close()`, and removes the handle from the internal
sessions map.

### 4.6 plan

Sends a planning prompt to an existing session.

**ACP adapter:** Translates to an ACP `session/prompt` request.
Returns the ACP response result directly.

**SDK adapter:** Looks up the session by adapter handle. Calls
`session.send(prompt)` to submit the prompt, then iterates
`session.stream()` to collect responses. During iteration:

- Messages with `type` of `"assistant"`, `"tool_progress"`, or
  `"system"` are emitted as progress notifications.
- A message with `type === "result"` and
  `subtype === "success"` provides the final result text.
- A message with `type === "result"` and any other subtype
  causes the operation to throw, using the `errors` array from
  the result message.

Returns `{ response: resultText }`.

### 4.7 fork

Forks an existing session.

**ACP adapter:** Translates to an ACP `session/fork` request.
Returns the ACP response result (expected shape: `ForkData`).

**SDK adapter:** Looks up the session by adapter handle, reads
the real SDK `sessionId` (which requires at least one `plan`
call to have initialized the session), and calls
`forkSession(sdkSessionId)`. Returns
`{ parentSessionId: handle, forkId: result.sessionId }` where
`handle` is the adapter-internal handle and `result.sessionId`
is the real SDK fork ID.

### 4.8 openFork

Opens a previously forked session as a new session.

**ACP adapter:** Translates to an ACP `session/fork` request
with the fork data as params.

**SDK adapter:** Calls
`unstable_v2_resumeSession(forkId, { model, permissionMode })`
to resume the forked session. Generates a new adapter-internal
handle, stores the resumed session, and returns
`{ sessionId: newHandle }`.

## 5. ACP Protocol Translation

The ACP adapter uses pure translation functions to convert
between Tisyn protocol messages and ACP JSON-RPC messages.

### 5.1 Tisyn-to-ACP Translation

`tisynExecuteToAcp(id, operation, args)` converts a Tisyn
`ExecuteRequest` into an `AcpRequest`:

1. Strips the agent prefix from the operation name.
2. Looks up the unwrap key and unwraps the parameter envelope.
3. Resolves the ACP wire method via the operation table (§4.1).
4. Returns an `AcpRequest` with `jsonrpc: "2.0"`, the request
   `id`, the resolved `method`, and the unwrapped `params`.

### 5.2 ACP-to-Tisyn Translation

- `acpSuccessToTisyn(id, result)` — Translates an ACP success
  response into a Tisyn `executeSuccess` message.
- `acpErrorToTisyn(id, error)` — Translates an ACP error
  response into a Tisyn `executeApplicationError` message.
  The error name is formatted as `AcpError({code})`.
- `acpNotificationToTisyn(token, params)` — Translates an ACP
  notification into a Tisyn `progressNotification`.

### 5.3 ACP Message Parsing

`parseAcpMessage(json)` validates a raw JSON value and returns
a discriminated ACP message:

- If the message has an `id` field: it is a response.
  - If it has an `error` field with numeric `code` and string
    `message`: it is an `AcpErrorResponse`.
  - If it has a `result` field: it is an `AcpSuccessResponse`.
  - Otherwise the parser MUST throw.
- If the message has a `method` field but no `id`: it is an
  `AcpNotification`.
- Otherwise the parser MUST throw.

All ACP messages MUST have `jsonrpc: "2.0"`.

### 5.4 ACP Wire Types

```typescript
interface AcpRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface AcpSuccessResponse {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

interface AcpErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: { code: number; message: string; data?: unknown };
}

interface AcpNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}
```

## 6. Transport-Level Protocol Handling

Three protocol messages are handled at the transport level,
outside the declared operation dispatch path. They are routed
by `message.method` checks, at the same level as each other.
These are NOT declared agent operations.

### 6.1 initialize

Both adapters synthesize an `InitializeResponse` when they
receive an `initialize` message. ACP processes do not speak
Tisyn protocol, so the binding handles the handshake
internally.

The synthesized response includes:
- `protocolVersion: "1.0"`
- `sessionId`: `"acp-{timestamp}"` (ACP adapter) or
  `"sdk-{timestamp}"` (SDK adapter)

The initialize message is NOT forwarded to the ACP process.

### 6.2 shutdown

**ACP adapter:** The shutdown message is NOT forwarded to the
ACP process. The adapter skips it along with initialize.

**SDK adapter:** On shutdown, the adapter closes all open
sessions (calling `session.close()` on each) and removes all
handles from the internal sessions map.

### 6.3 cancel

Cancel is a transport-level protocol message, not a declared
agent operation. When structured concurrency halts a task with
an in-flight dispatch, the transport layer sends a `cancel`
message.

**ACP adapter:** Translates the cancel message into an ACP
`session/cancel` JSON-RPC request. The request ID is
`"cancel-{originalId}"` and the params include the original
request `id` and `reason`.

**SDK adapter:** Ignores cancel messages (returns immediately).
Structured concurrency handles task cancellation directly via
Effection's scope halting.

## 7. Progress Forwarding

### 7.1 ACP Progress

When the ACP process sends a JSON-RPC notification (a message
with `method` but no `id`), the adapter translates it to a
Tisyn `progressNotification`.

The progress token is resolved by looking up the
`request_id` or `token` field from the notification's `params`.
The adapter maintains a `pendingTokens` map that correlates
request IDs with their progress tokens.

### 7.2 SDK Progress

During `plan` execution, the SDK adapter iterates the
session's message stream. Messages with `type` of
`"assistant"`, `"tool_progress"`, or `"system"` are emitted
as Tisyn `progressNotification` messages using the execute
request's progress token.

## 8. SDK Adapter Handle Model

The SDK adapter uses an adapter-internal handle model to
insulate workflows from real SDK session IDs.

### 8.1 Handle Generation

Handles are opaque strings with the format `"cc-{N}"` where
`N` is a monotonically incrementing counter scoped to the
transport resource lifetime. The counter starts at 0 and
increments on each `newSession` or `openFork` call.

### 8.2 Handle Lifecycle

- **Created** by `newSession` and `openFork`.
- **Stored** in an internal `Map<string, unknown>` keyed by
  handle.
- **Removed** by `closeSession`.
- **Looked up** by `plan`, `fork`, `closeSession` via
  `getSession(handle)`, which throws if the handle is not
  found.

### 8.3 Shutdown

On `shutdown`, all sessions in the map are closed and all
handles are removed.

## 9. Transport Lifecycle

### 9.1 ACP Transport

The ACP adapter spawns a subprocess via `exec()` when the
transport resource is created. The `exec()` resource owns the
subprocess: when the transport resource scope exits, the
subprocess is terminated (SIGTERM to the process group).

The transport MUST persist across session open/close cycles
within the same scope. Closing a session does NOT exit the
transport scope, so the subprocess continues running.

A background task reads from the subprocess stdout, parsing
NDJSON lines into ACP messages. When stdout ends (subprocess
exits unexpectedly), the adapter calls `waitForProcessExit()`
and throws the resulting diagnostic error. This preempts the
generic "Transport closed" error that would otherwise surface.

### 9.2 SDK Transport

The SDK adapter does not spawn a subprocess directly. The SDK
manages Claude Code subprocess lifecycle internally. The
session map lifetime is tied to the transport resource scope.

### 9.3 Subprocess Diagnostics (ACP)

The ACP adapter captures stderr into chunks via a background
task. When the subprocess exits, the diagnostic error includes:

- Exit information: `"exited with code {N}"` or
  `"killed by signal {signal}"`
- Command string: `"(command: {cmd} {args})"`
- Captured stderr (if non-empty): `"\nstderr:\n{stderr}"`

The full format is:
```
Claude ACP subprocess {exitInfo} (command: {cmd} {args})
stderr:
{stderr}
```

## 10. Error Handling

### 10.1 ACP Errors

ACP error responses are translated to Tisyn
`executeApplicationError` messages. The error name is formatted
as `AcpError({code})` where `code` is the numeric error code
from the ACP response.

### 10.2 SDK Errors

Exceptions thrown during SDK operation handling are caught and
translated to Tisyn `executeApplicationError` messages,
preserving the original error `name` and `message`.

For `plan` operations specifically: if the stream result
message has `subtype !== "success"`, the adapter throws an
error constructed from the `errors` array in the result message
(joined with `"; "`) or a fallback message
`"Claude query failed: {subtype}"`.

### 10.3 Unknown Operations

Both adapters MUST throw when encountering an unknown
operation name. The ACP adapter error message lists all known
operations from the `OPERATION_TO_ACP_METHOD` table. The SDK
adapter throws `"Unknown operation: {opName}"`.

## 11. Conformance

### 11.1 Observable Boundary

The following are normative and observable:

- Capability shape: the five declared operations and their
  existence on the agent contract
- Returned result values and their shapes
- Error categories and propagation behavior
- Progress event sequences
- Transport persistence across session lifecycle
- Adapter-internal handle format (cc-N prefix) for the SDK
  adapter

The following are NOT normative (implementation-defined):

- Session IDs, connection identifiers, or process IDs
- Whether the same transport connection is reused across
  sessions
- ACP protocol message shapes and field names (these are
  adapter-internal wire details)
- stdio framing details
- The specific timestamp component of synthesized session IDs

## 12. Future Work

A future specification may define an authored
`ClaudeCode().open(...)` capability surface with execution
handles, `supervise(...)` consumption, single-slot
enforcement, event delivery, and replay semantics. Such a
surface would layer on top of the transport adapters
documented here, using `createBinding` or `createSdkBinding`
as the underlying transport substrate.
