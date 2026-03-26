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

- `HostMessage`: Union together all messages the host may send to a remote agent.
- `AgentMessage`: Union together all messages a remote agent may send back to the host.
- `InitializeRequest`: Represent the host-to-agent handshake request that opens a protocol session.
- `InitializeResponse`: Represent the agent’s response to initialization.
- `ExecuteRequest`: Represent a request to invoke one remote operation.
- `ExecuteResponse`: Represent the success or failure response for an execute request.
- `ProgressNotification`: Represent a one-way progress update during remote execution.
- `CancelNotification`: Represent a one-way request to cancel an in-flight execution.
- `ShutdownNotification`: Represent a one-way notification that the protocol session is ending.
- `ResultPayload`: Represent the JSON-compatible result envelope carried by execution responses.
- `ApplicationError`: Represent an application-level execution failure returned over the protocol.

### Constants

- `ProtocolErrorCode`: Export the stable numeric error codes used for protocol-layer failures.

### Constructors

- `initializeRequest`: Build a well-shaped initialize request message.
- `initializeResponse`: Build a successful initialize response message.
- `initializeProtocolError`: Build an initialize failure response at the protocol layer.
- `executeRequest`: Build a request to execute one operation remotely.
- `executeSuccess`: Build a successful execute response message.
- `executeApplicationError`: Build an execute response that carries an application error.
- `executeProtocolError`: Build an execute response that carries a protocol error.
- `progressNotification`: Build a progress notification message.
- `cancelNotification`: Build a cancellation notification message.
- `shutdownNotification`: Build a shutdown notification message.

### Parsers

- `parseHostMessage`: Validate and narrow parsed JSON into one of the allowed host message shapes.
- `parseAgentMessage`: Validate and narrow parsed JSON into one of the allowed agent message shapes.

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
