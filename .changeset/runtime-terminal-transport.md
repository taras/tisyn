---
"@tisyn/transport": minor
---

Terminal middleware installed by `installAgentTransport(...)` and
`installRemoteAgent(...)` now delegates its live `session.execute(...)`
streaming work through `runAsTerminal(effectId, data, liveWork)`
from `@tisyn/effects`. Under replay, the runtime's terminal
boundary substitutes stored results in place of re-sending remote
RPCs — so transport-level `session.execute` is not re-invoked and
streams are not re-opened for durable effects. Progress-emission
remains live during the live-dispatch path. See
`tisyn-scoped-effects-specification.md` §9.5 for the
middleware-author contract. User-visible API is unchanged; this
update makes the built-in bindings exemplify the contract.
