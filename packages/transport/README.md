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

- `installRemoteAgent`
- `createSession`
- `ProtocolSession`
- `CreateSessionOptions`

### Transport interfaces

- `Transport`
- `AgentTransport`
- `AgentTransportFactory`

### Concrete transports

- `inprocessTransport`
- `stdioTransport`
- `websocketTransport`
- `workerTransport`
- `ssePostTransport`

### Agent-side adapters

- `createStdioAgentTransport`
- `createSsePostAgentTransport`
- `createProtocolServer`
- `AgentServerTransport`
- `ProtocolServer`

### Verification helpers

- `transportComplianceSuite`
- `TransportFactoryBuilder`

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
