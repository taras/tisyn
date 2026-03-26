# `@tisyn/protocol`

`@tisyn/protocol` defines the typed wire messages for host/agent remoting. It gives transports and protocol servers a shared JSON-RPC-like contract for initialization, execution, cancellation, and shutdown.

## Where It Fits

This package is the wire contract between `@tisyn/agent` declarations and concrete transport implementations.

- `@tisyn/transport` reads and writes these messages over stdio, WebSocket, worker, HTTP, or in-process channels.
- `@tisyn/agent` remains protocol-agnostic.
- `@tisyn/ir` supplies the JSON-compatible values carried in request payloads and results.

Use this package when you are building transport adapters, framing layers, or protocol-aware tooling.

## Core Concepts

- host messages vs agent messages
- initialize / execute request-response pairs
- cancel and shutdown notifications
- message constructors for producing well-shaped protocol traffic
- parsers for validating and narrowing parsed JSON values

## Main APIs

### Types

- `HostMessage`
- `AgentMessage`
- `InitializeRequest`
- `InitializeResponse`
- `ExecuteRequest`
- `ExecuteResponse`
- `ProgressNotification`
- `CancelNotification`
- `ShutdownNotification`
- `ResultPayload`
- `ApplicationError`

### Constants

- `ProtocolErrorCode`

### Constructors

- `initializeRequest`
- `initializeResponse`
- `initializeProtocolError`
- `executeRequest`
- `executeSuccess`
- `executeApplicationError`
- `executeProtocolError`
- `progressNotification`
- `cancelNotification`
- `shutdownNotification`

### Parsers

- `parseHostMessage`
- `parseAgentMessage`

## Example

```ts
import { executeRequest, parseAgentMessage } from "@tisyn/protocol";

const request = executeRequest("req-1", {
  executionId: "exec-1",
  taskId: "root",
  operation: "double",
  args: [{ value: 21 }],
});

const incoming = parseAgentMessage(JSON.parse(rawLine));
```

## Relationship to the Rest of Tisyn

- [`@tisyn/transport`](../transport/README.md) is the main consumer of these message shapes.
- [`@tisyn/agent`](../agent/README.md) supplies the operations that protocol messages eventually target.
- [`@tisyn/ir`](../ir/README.md) supplies the `Val`-compatible payloads carried inside requests and responses.

## Boundaries

`@tisyn/protocol` does not open sockets, spawn processes, or install agents. It owns:

- message types
- constructors
- parsers
- protocol error codes

Everything about sessions, IO, retry, and lifecycle belongs to transport.
