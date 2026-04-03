# @tisyn/config

Pure constructors, types, validation, and walking for Tisyn workflow configuration descriptors.

This package owns the **descriptor data model** — tagged data structures that declare a workflow's runtime topology (agents, transports, environment references, journals, entrypoints, servers). All constructors are pure functions that return serializable data within the `tisyn_config` tagged domain.

## Constructor Vocabulary

```typescript
import {
  workflow, agent, transport, env, journal, entrypoint, server,
} from "@tisyn/config";

export default workflow({
  run: "chat",
  agents: [
    agent("llm", transport.worker("./llm-worker.js")),
    agent("app", transport.local("./browser-agent.ts")),
  ],
  journal: journal.file(env("JOURNAL_PATH", "./data/chat.journal")),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({ port: env("PORT", 3000) }),
    }),
  },
});
```

### Constructors

| Constructor | Output |
|---|---|
| `workflow({ run, agents, journal?, entrypoints? })` | `WorkflowDescriptor` |
| `agent(id, transport)` | `AgentBinding` |
| `transport.worker(url)` | `WorkerTransportDescriptor` |
| `transport.local(module)` | `LocalTransportDescriptor` |
| `transport.stdio(command, args?)` | `StdioTransportDescriptor` |
| `transport.websocket(url)` | `WebSocketTransportDescriptor` |
| `transport.inprocess(module)` | `InprocessTransportDescriptor` |
| `env(name, default)` | `EnvOptionalDescriptor` |
| `env.required(name)` | `EnvRequiredDescriptor` |
| `env.secret(name)` | `EnvSecretDescriptor` |
| `journal.file(path)` | `FileJournalDescriptor` |
| `journal.memory()` | `MemoryJournalDescriptor` |
| `entrypoint(config?)` | `EntrypointDescriptor` |
| `server.websocket({ port, static? })` | `ServerDescriptor` |

Transport, journal path, server port, and stdio command/args positions accept `EnvDescriptor` nodes for deferred environment resolution.

## Validation

```typescript
import { validateConfig } from "@tisyn/config";

const result = validateConfig(descriptor);
if (!result.ok) {
  console.error(result.errors);
}
```

Validates rules V1-V10 from the Configuration Specification:
- V1: recognized `tisyn_config` discriminant
- V2: workflow has `run` and non-empty `agents`
- V3: agents have non-empty `id` and valid transport
- V4: unique agent ids
- V5: transports have `kind` and required fields
- V6: env mode/default consistency
- V7: entrypoint keys match `[a-z][a-z0-9-]*`
- V8: all values in portable serializable data domain
- V9: no node with both `tisyn_config` and `tisyn`
- V10: base workflow must not have `server`

## Walking

```typescript
import { walkConfig, collectEnvNodes } from "@tisyn/config";

// Depth-first traversal of all tisyn_config nodes
walkConfig(descriptor, (node, path) => {
  console.log(path, node.tisyn_config);
});

// Collect all environment variable references
const envNodes = collectEnvNodes(descriptor);
```

## Specification

See [Configuration Specification](../../specs/tisyn-config-specification.md) and [Configuration Test Plan](../../specs/tisyn-config-test-plan.md).
