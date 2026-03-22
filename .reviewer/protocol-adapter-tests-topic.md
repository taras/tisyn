Topic to revisit: protocol adapter tests after `@tisyn/protocol` v1

Decision:

- Keep `@tisyn/protocol` v1 narrow: message types, constants, package wiring, and shape tests only.
- Do not add agent/runtime protocol-behavior tests until there is a real adapter layer that constructs and parses protocol messages.

Later follow-up branch should cover:

- adapter tests in `@tisyn/agent` once JSON-RPC messages are turned into agent/runtime actions
- adapter tests in `@tisyn/runtime` once effect dispatch is mapped to `Execute` / `Result` / `Cancel` / `Progress`
- protocol-vs-application error boundary tests using real envelopes
- journaling assertions only after protocol responses are actually consumed by runtime code

Reason:

- current agent/runtime layers do not yet implement a protocol adapter
- testing protocol behavior earlier would force wire semantics into the wrong layer
