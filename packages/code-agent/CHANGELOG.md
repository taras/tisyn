# @tisyn/code-agent

## 0.3.0

### Minor Changes

- e1e37b2: **BREAKING:** The CodeAgent contract test plan and mock-harness
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

- 51d11f5: Adapters can now enforce the full declared `newSession` payload
  shape `{ model?: string }` at the contract boundary. New public
  export: `validateNewSessionPayload(payload)` throws an `Error` with
  `name === "InvalidPayload"` when the payload is not a plain object,
  contains any key other than `model`, or carries `model` as a
  non-string. The check runs before any default-application logic.

  Use this in any adapter that implements `code-agent.newSession`. The
  declared payload has no required field, so without an explicit
  boundary check a malformed payload (wrapped `{ config: { model } }`,
  non-object, array, wrong-typed `model`) would be silently tolerated.

  Test plan CA-PAYLOAD-06 ("Wrapped payload rejected") restates the
  expectation: `newSession` MUST surface `InvalidPayload` for unknown
  keys; other operations rely on natural required-field failure.

### Patch Changes

- Updated dependencies [e7d62c6]
- Updated dependencies [4766e26]
- Updated dependencies [29707e6]
- Updated dependencies [c268fc0]
- Updated dependencies [969d91f]
- Updated dependencies [ad2e267]
- Updated dependencies [dde36c6]
- Updated dependencies [0f255bf]
- Updated dependencies [2037b6b]
- Updated dependencies [29707e6]
- Updated dependencies [e7d62c6]
- Updated dependencies [51d11f5]
- Updated dependencies [4766e26]
  - @tisyn/agent@0.15.0
  - @tisyn/effects@0.3.0
  - @tisyn/transport@0.15.0
  - @tisyn/ir@0.15.0
  - @tisyn/protocol@0.15.0

## 0.2.0

### Minor Changes

- a12fefc: Workflows can now declare code-agent sessions against one shared portable
  surface. The new `@tisyn/code-agent` package publishes the `CodeAgent`
  contract — five operations (`newSession`, `closeSession`, `prompt`,
  `fork`, `openFork`), shared session/result types (`SessionHandle`,
  `PromptResult`, `ForkData`), and a published mock harness — so Claude
  Code, Codex, and future adapters can be driven through the same authored
  operations without redefining their own session or result shapes.

### Patch Changes

- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
  - @tisyn/agent@0.14.0
  - @tisyn/effects@0.2.0
  - @tisyn/transport@0.14.0
  - @tisyn/ir@0.14.0
  - @tisyn/protocol@0.14.0
