---
"@tisyn/compiler": minor
"@tisyn/agent": minor
"@tisyn/transport": minor
---

**BREAKING:** Single-parameter ambient agent methods no longer wrap
their payload under the authored parameter name. Calling
`App().loadChat({ messages })` now lowers to an effect payload of
`{ messages }` directly — previously it lowered to
`{ input: { messages } }` (or whatever the authored parameter name
was). Generated `OperationSpec`/`operation<>` types reflect the
unwrapped shape, so handlers receive the payload directly without
an extra destructure step.

Multi-parameter ambient methods are unchanged: their arguments are
still lowered to a named object keyed by the authored parameter
names. Zero-parameter ambient methods remain rejected by
contract discovery.

This is a deliberate cleanup with no compatibility shim. Update
binding handlers, transport stubs, and assertions that currently
destructure or assert against the wrapper key (e.g. `{ input }`)
to consume the unwrapped payload directly.
