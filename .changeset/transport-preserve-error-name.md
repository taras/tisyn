---
"@tisyn/transport": minor
---

`installRemoteAgent` and `installAgentTransport` now preserve the
adapter-supplied `error.name` when reconstructing thrown `Error`s
from `executeApplicationError` messages. Previously the name was
dropped and the workflow surface always saw `name === "Error"`.

Adapters that set distinct names (e.g. `InvalidPayload`,
`SessionNotFound`, `NotSupported`) round-trip those names to the
caller and can be branched on by `instanceof`-style discrimination
or `err.name === "..."` checks.
