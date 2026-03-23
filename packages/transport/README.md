# `@tisyn/transport`

Remote agent sessions and concrete transports for the Tisyn host/agent protocol.

Use this package when an agent call needs to cross an in-process, subprocess, worker, websocket, or HTTP boundary.

## Main exports

- `installRemoteAgent()`
- `createSession()`
- transports:
  - `inprocessTransport()`
  - `stdioTransport()`
  - `websocketTransport()`
  - `workerTransport()`
  - `ssePostTransport()`
- agent-side adapters:
  - `createStdioAgentTransport()`
  - `createSsePostAgentTransport()`
- `createProtocolServer()`

## Example

```ts
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent, websocketTransport } from "@tisyn/transport";

const math = agent("math", {
  double: operation<{ value: number }, number>(),
});

yield * installRemoteAgent(math, websocketTransport({ url: "ws://localhost:8080" }));
const result = yield * invoke(math.double({ value: 21 }));
```

## Available transports

- `inprocess`: reference transport for same-process communication and compliance tests
- `stdio`: subprocess transport over stdin/stdout
- `websocket`: long-lived socket transport for remote agents
- `worker`: worker-thread transport
- `sse-post`: asymmetric HTTP transport using POST inbound and SSE outbound

## Relationship to the rest of Tisyn

- [`@tisyn/protocol`](../protocol/README.md) defines the message shapes used by sessions and transports.
- [`@tisyn/agent`](../agent/README.md) defines the declarations being installed remotely.
- `createProtocolServer()` adapts a bound `implementAgent()` result into an agent-side protocol server without making `@tisyn/agent` depend on protocol types.
