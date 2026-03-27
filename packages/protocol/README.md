# `@tisyn/protocol`

`@tisyn/protocol` defines the typed wire contract for host/agent remoting in Tisyn. It provides a shared, JSON-compatible protocol for session setup, remote execution, progress reporting, cancellation, and shutdown so transports and protocol servers can interoperate without embedding transport-specific concerns.

Use this package when you are building transport adapters, framing layers, protocol servers, or tooling that needs to understand or produce Tisyn protocol traffic.

## Where It Fits

`@tisyn/protocol` sits between agent definitions and the transport layer.

- `@tisyn/agent` defines operations and remains protocol-agnostic.
- `@tisyn/protocol` defines the message shapes used to talk to remote agents.
- `@tisyn/transport` carries those messages over stdio, WebSocket, worker, HTTP, or in-process channels.
- `@tisyn/ir` provides the JSON-compatible values used in request arguments, progress payloads, and results.

A useful way to think about this package is: `@tisyn/agent` defines **what** can be called, `@tisyn/protocol` defines **how those calls are described on the wire**, and `@tisyn/transport` defines **how those messages move**.

## What This Package Provides

`@tisyn/protocol` owns four things:

- strongly typed host-to-agent and agent-to-host message unions
- constructors for producing well-formed protocol messages
- parsers for validating and narrowing parsed JSON input
- stable protocol-layer error codes

It does **not** open sockets, spawn processes, manage retries, or coordinate session lifecycle beyond the meaning of protocol messages themselves.

## Core Concepts

### Host and Agent Messages

The protocol is split into two directional message families:

- **Host messages** are sent from the caller to the remote agent.
- **Agent messages** are sent from the remote agent back to the caller.

This separation keeps message flow explicit and makes it easier for transports and servers to validate traffic by direction.

### Request/Response Pairs

Two protocol interactions use request/response exchange:

- **initialize** establishes a protocol session
- **execute** invokes one remote operation

Each request has a corresponding response shape, including success and failure cases.

### Notifications

Some protocol messages are one-way notifications rather than request/response pairs:

- **progress** reports execution updates while work is in flight
- **cancel** asks that an in-flight execution be cancelled
- **shutdown** signals that the session is ending

### JSON-Compatible Payloads

All protocol payloads are JSON-compatible so they can move cleanly across process, worker, and network boundaries. Argument and result values are shaped to align with Tisyn’s IR-compatible value model.

### Constructors and Parsers

This package provides both:

- **constructors** for producing well-shaped outbound messages
- **parsers** for validating inbound JSON and narrowing it to known protocol types

That lets transports stay small and predictable: parse incoming bytes into JSON, validate them as protocol messages, and then hand typed values to the rest of the system.

## Main APIs

### Types

- `HostMessage`  
  Union of all messages the host may send to a remote agent.

- `AgentMessage`  
  Union of all messages a remote agent may send back to the host.

- `InitializeRequest`  
  Host-to-agent request that begins a protocol session.

- `InitializeResponse`  
  Agent response to initialization, including protocol success or failure.

- `ExecuteRequest`  
  Request to invoke a single remote operation.

- `ExecuteResponse`  
  Response carrying either a successful result or an execution failure.

- `ProgressNotification`  
  One-way message reporting progress during remote execution.

- `CancelNotification`  
  One-way message requesting cancellation of an in-flight execution.

- `ShutdownNotification`  
  One-way message indicating that the protocol session is ending.

- `ResultPayload`  
  JSON-compatible result envelope carried by execute responses.

- `ApplicationError`  
  Application-level failure returned from remote execution.

### Constants

- `ProtocolErrorCode`  
  Stable numeric error codes for protocol-layer failures such as malformed messages, invalid state, or unsupported operations.

### Constructors

- `initializeRequest`  
  Build a well-formed initialize request.

- `initializeResponse`  
  Build a successful initialize response.

- `initializeProtocolError`  
  Build an initialize failure response at the protocol layer.

- `executeRequest`  
  Build a request to execute one operation remotely.

- `executeSuccess`  
  Build a successful execute response.

- `executeApplicationError`  
  Build an execute response carrying an application-level failure.

- `executeProtocolError`  
  Build an execute response carrying a protocol-layer failure.

- `progressNotification`  
  Build a progress notification.

- `cancelNotification`  
  Build a cancellation notification.

- `shutdownNotification`  
  Build a shutdown notification.

### Parsers

- `parseHostMessage`  
  Validate and narrow parsed JSON into one of the allowed host message shapes.

- `parseAgentMessage`  
  Validate and narrow parsed JSON into one of the allowed agent message shapes.

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

## Typical Use

A transport or protocol server usually uses this package in three steps:

1. receive a raw message and decode it as JSON
2. validate it with `parseHostMessage` or `parseAgentMessage`
3. construct responses and notifications with the provided constructors

That keeps wire handling strict and centralized, while leaving actual IO, process management, and retry logic to the transport layer.

## Relationship to the Rest of Tisyn

- [`@tisyn/transport`](../transport/README.md) is the primary consumer of these message shapes and constructors.
- [`@tisyn/agent`](../agent/README.md) provides the remote operations that protocol execution messages eventually target.
- [`@tisyn/ir`](../ir/README.md) supplies the `Val`-compatible payloads carried inside requests, progress updates, and responses.

## Boundaries

`@tisyn/protocol` is intentionally narrow in scope.

It owns:

- protocol message types
- protocol message constructors
- protocol message parsers
- protocol-layer error codes

It does **not** own:

- sockets, streams, or HTTP handling
- process or worker creation
- retry behavior
- session orchestration beyond message semantics
- transport lifecycle management
- agent installation or registration

Those responsibilities belong to transport and hosting layers.

## When to Use This Package

Use `@tisyn/protocol` when you need to:

- implement a new Tisyn transport
- build a protocol server or client
- validate host/agent message traffic
- generate correct wire messages in tests or tooling
- reason about the host/agent remoting contract independently of any specific transport

If you only want to define agent operations, use `@tisyn/agent` instead. If you want to send these messages over a concrete channel, use `@tisyn/transport`.
