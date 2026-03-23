# `@tisyn/protocol`

The host/agent wire protocol: message types, constructors, and parsers.

Use this package when you are building or adapting transports, sessions, or tools that need to read and write typed protocol messages.

## Main exports

- protocol message types like `HostMessage`, `AgentMessage`, `ExecuteRequest`, and `ExecuteResponse`
- message constructors like `initializeRequest()`, `executeRequest()`, `executeSuccess()`, and `shutdownNotification()`
- parsers `parseHostMessage()` and `parseAgentMessage()`

## Example

```ts
import { executeRequest, parseAgentMessage } from "@tisyn/protocol";

const request = executeRequest("req-1", {
  executionId: "exec-math-0",
  taskId: "root",
  operation: "double",
  args: [{ value: 21 }],
});

const message = parseAgentMessage(JSON.parse(rawLine));
```

## Relationship to the rest of Tisyn

- [`@tisyn/transport`](../transport/README.md) uses these message shapes for sessions and concrete transports.
- [`@tisyn/agent`](../agent/README.md) stays protocol-agnostic.
- [`@tisyn/ir`](../ir/README.md) provides the JSON-compatible value types carried inside protocol payloads.
