---
"@tisyn/protocol": minor
---

Add optional `middleware` field to `ExecuteRequest.params`.

- `ExecuteRequest.params.middleware?: Val | null` carries an IR function node (as a plain JSON value) from host to agent, enabling the host to impose cross-boundary middleware restrictions on the delegated execution
