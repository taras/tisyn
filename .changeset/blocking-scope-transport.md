---
"@tisyn/transport": minor
---

Extract `installAgentTransport` as a low-level transport primitive.

- New `installAgentTransport(agentId, factory)` takes a plain agent-ID string and factory instead of a typed `AgentDeclaration`; sends empty capabilities (`methods: []`)
- Used by the runtime scope orchestrator where only the agent-ID string and factory value are available from the IR environment
- `installRemoteAgent` is unchanged; `installAgentTransport` is an independent addition
