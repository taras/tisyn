# @tisyn/claude-code

## 0.12.0

### Minor Changes

- dd4f627: Expose `createMockClaudeCodeTransport` (and its `MockClaudeCodeConfig` / `MockOperationConfig` types) from the package root so cross-package test harnesses can drive the Claude Code ACP agent without touching internal deep paths. Previously the mock was a test-only internal of this package; it is now a first-class test-helper surface consumers can import via `@tisyn/claude-code`.

### Patch Changes

- Updated dependencies [db46668]
- Updated dependencies [12f992d]
  - @tisyn/agent@0.13.0
  - @tisyn/transport@0.13.0
  - @tisyn/ir@0.13.0
  - @tisyn/protocol@0.13.0

## 0.11.0

### Minor Changes

- d804792: Add dedicated package for driving Claude Code from Tisyn workflows.

  - Workflows can open, plan, fork, and close Claude Code sessions through two adapter paths: ACP stdio transport and the `@anthropic-ai/claude-agent-sdk` TypeScript API
  - Session lifecycle types (`SessionHandle`, `PlanResult`, `ForkData`) are published for use in authored workflow signatures
  - When a Claude Code subprocess dies, the binding surfaces exit code and stderr instead of a generic transport error

### Patch Changes

- Updated dependencies [34d48ce]
- Updated dependencies [9801960]
  - @tisyn/agent@0.12.0
  - @tisyn/transport@0.12.0
  - @tisyn/ir@0.12.0
  - @tisyn/protocol@0.12.0
