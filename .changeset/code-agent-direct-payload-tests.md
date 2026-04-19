---
"@tisyn/code-agent": minor
---

**BREAKING:** The CodeAgent contract test plan and mock-harness
test suite no longer accept the legacy single-parameter envelope
shape (`{ args: { session, prompt } }`, `{ config: { model } }`,
`{ handle: { sessionId } }`, `{ session: { sessionId } }`,
`{ data: forkData }`). The mock harness asserts that handlers
receive the direct payload verbatim (`{ session, prompt }`,
`{ model }`, `{ sessionId }`, `forkData`).

The `tisyn-code-agent-test-plan.md` `CA-UNWRAP-*` section is
replaced by `CA-PAYLOAD-*`, which restates the contract as
direct-payload forwarding with no compatibility shim.

Conforming adapters and any downstream test suites built on this
plan must dispatch unwrapped payloads.
