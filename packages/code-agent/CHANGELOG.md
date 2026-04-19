# @tisyn/code-agent

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
