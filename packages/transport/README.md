# `@tisyn/transport`

`@tisyn/transport` turns typed agent declarations into remote capabilities. It manages host-side remote installation, protocol sessions, and concrete transport adapters for stdio, WebSocket, worker, HTTP, and in-process execution.

## Where It Fits

This package is the remoting layer above protocol and below application orchestration.

- `@tisyn/agent` defines what can be called.
- `@tisyn/protocol` defines the wire messages.
- `@tisyn/transport` opens sessions and moves those messages across concrete boundaries.

Use it when a Tisyn effect should execute somewhere other than the current process or scope.

## Core Concepts

- `installRemoteAgent()`: install a declaration so its operations dispatch remotely
- `createSession()`: host-side protocol session management
- transport factories like stdio, WebSocket, worker, SSE/POST, and in-process
- agent-side adapters like `createProtocolServer()` and `createStdioAgentTransport()`

## Main APIs

### Host-side installation and sessions

- `installRemoteAgent`: Install an agent declaration so its invocations are forwarded over a transport session.
- `createSession`: Create and manage a host-side protocol session over a concrete transport.
- `ProtocolSession`: Represent the live session object that manages protocol lifecycle and request routing.
- `CreateSessionOptions`: Describe the configuration accepted by `createSession()`.

### Transport interfaces

- `Transport`: Define the host-side transport contract used to open a protocol session.
- `AgentTransport`: Define the agent-side transport contract used by protocol servers.
- `AgentTransportFactory`: Define a factory that creates agent-side transports on demand.

### Concrete transports

- `inprocessTransport`: Create an in-process reference transport with no real IO boundary.
- `stdioTransport`: Create a transport that talks to a child process over stdin/stdout.
- `websocketTransport`: Create a transport that speaks the protocol over WebSocket.
- `workerTransport`: Create a transport that speaks the protocol through a worker boundary.
- `ssePostTransport`: Create an HTTP transport that combines POST requests with SSE responses.

### Agent-side adapters

- `createStdioAgentTransport`: Adapt stdin/stdout streams into an agent-side transport.
- `createSsePostAgentTransport`: Adapt POST and SSE channels into an agent-side transport.
- `createProtocolServer`: Build the agent-side protocol loop that serves requests over a transport.
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

- `inprocessTransport`: reference transport and compliance baseline
- `stdioTransport`: subprocess-style remoting over stdin/stdout
- `websocketTransport`: long-lived remote agent sessions
- `workerTransport`: worker-thread remoting
- `ssePostTransport`: asymmetric HTTP transport using POST inbound and SSE outbound

## Relationship to the Rest of Tisyn

- [`@tisyn/protocol`](../protocol/README.md) provides the message types and constructors used on the wire.
- [`@tisyn/agent`](../agent/README.md) provides the declarations being installed remotely.
- [`@tisyn/runtime`](../runtime/README.md) executes programs that ultimately dispatch through these installed remote agents.

## Boundaries

`@tisyn/transport` owns:

- session management
- remote installation
- concrete transport factories
- agent-side protocol serving

It does not own:

- the protocol schema itself
- authored workflow compilation
- kernel evaluation semantics
