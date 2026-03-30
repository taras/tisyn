# `@tisyn/transport`

`@tisyn/transport` turns typed agent declarations into remote capabilities. It installs host-side agent declarations so their operations can execute across process, thread, network, or in-process boundaries, while handling protocol sessions and concrete transport adapters for stdio, WebSocket, worker, HTTP, and local execution.

It is the layer that makes agent handoff possible.

## Where It Fits

This package sits above protocol and below orchestration.

- `@tisyn/agent` defines the operations an agent exposes.
- `@tisyn/protocol` defines the messages exchanged over the wire.
- `@tisyn/transport` opens sessions, binds declarations to those sessions, and moves protocol messages across real boundaries.

Use `@tisyn/transport` when a Tisyn operation should run somewhere other than the current process or scope.

## What It Provides

`@tisyn/transport` is responsible for:

- installing agent declarations as remote capabilities
- opening and managing host-side protocol sessions
- adapting protocol traffic onto concrete transports
- serving agent requests on the remote side
- providing transport conformance helpers

In practice, this lets you treat an agent declaration the same way whether it is backed by a subprocess, worker, network endpoint, or local in-process adapter.

## Core Concepts

### Remote installation

`installRemoteAgent()` installs an agent declaration so that invocations are forwarded over a transport session instead of being resolved locally.

### Sessions

`createSession()` creates the host-side protocol session that manages lifecycle, request routing, and message flow over a transport.

### Concrete transports

Transport factories provide the boundary over which protocol messages move. The package includes adapters for:

- in-process execution
- stdio
- WebSocket
- workers
- SSE/POST over HTTP

### Agent-side serving

On the remote side, adapters such as `createProtocolServer()` and `createStdioAgentTransport()` expose an agent implementation over a concrete transport.

## Main APIs

### Host-side installation and sessions

- `installRemoteAgent`: Install an agent declaration so invocations are dispatched over a transport session.
- `useTransport`: Install an agent declaration as a remote capability and register it in the scope-local bound-agent registry, making it accessible to `useAgent()`.
- `createSession`: Create and manage a host-side protocol session over a concrete transport.
- `ProtocolSession`: Represent the live session object that manages lifecycle and routing.
- `CreateSessionOptions`: Describe the options accepted by `createSession()`.

### Transport interfaces

- `Transport`: Define the host-side transport contract used to open protocol sessions.
- `AgentTransport`: Define the agent-side transport contract used by protocol servers.
- `AgentTransportFactory`: Define a factory that creates agent-side transports on demand.

### Concrete transports

- `inprocessTransport`: Create an in-process reference transport with no real IO boundary.
- `stdioTransport`: Create a transport that communicates with a child process over stdin/stdout.
- `websocketTransport`: Create a transport that speaks the protocol over WebSocket.
- `workerTransport`: Create a transport that crosses a worker boundary.
- `ssePostTransport`: Create an HTTP transport that combines POST requests with SSE responses.

### Agent-side adapters

- `createStdioAgentTransport`: Adapt stdin/stdout streams into an agent-side transport.
- `createSsePostAgentTransport`: Adapt POST and SSE channels into an agent-side transport.
- `createProtocolServer`: Create the agent-side protocol loop that serves requests over a transport. When an execute request carries a `middleware` IR node, the server validates it and installs it as a non-bypassable enforcement wrapper and cross-boundary carrier for that execution scope.
- `AgentServerTransport`: Define the server-side transport contract consumed by `createProtocolServer()`.
- `ProtocolServer`: Represent the running server-side protocol adapter.

### Verification helpers

- `transportComplianceSuite`: Run the shared conformance checks against a transport implementation.
- `TransportFactoryBuilder`: Type the helper shape used to construct transports for compliance tests.

## Example

```ts
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent, websocketTransport } from "@tisyn/transport";

const math = agent("math", {
  double: operation<{ input: { value: number } }, number>(),
});

yield* installRemoteAgent(
  math,
  websocketTransport({ url: "ws://localhost:8080" }),
);

const result = yield* invoke(math.double({ input: { value: 21 } }));
```

## Choosing a Transport

Choose the transport that matches the boundary you need:

- `inprocessTransport`: reference transport and compliance baseline
- `stdioTransport`: subprocess-style remoting over stdin/stdout
- `websocketTransport`: long-lived remote sessions over a network connection
- `workerTransport`: remoting across a worker boundary
- `ssePostTransport`: asymmetric HTTP remoting using POST inbound and SSE outbound

## Relationship to the Rest of Tisyn

- [`@tisyn/agent`](../agent/README.md) defines the typed agent declarations installed remotely.
- [`@tisyn/protocol`](../protocol/README.md) provides the message types and wire-level protocol used by sessions and servers.
- [`@tisyn/runtime`](../runtime/README.md) executes programs that may ultimately dispatch work through remote agents installed by this package.

## Boundaries

`@tisyn/transport` owns:

- remote installation
- session management
- concrete transport factories
- agent-side protocol serving
- transport conformance helpers

It does not own:

- protocol message definitions
- workflow authoring or compilation
- kernel evaluation semantics
- agent declarations themselves

## Summary

Use `@tisyn/transport` when agent operations need to cross a real boundary.

It keeps agent declarations typed and local in shape, while making their execution remote in reality.
