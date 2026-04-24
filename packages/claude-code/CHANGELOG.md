# @tisyn/claude-code

## 0.14.0

### Minor Changes

- 89c8355: **BREAKING:** The Claude Code adapter no longer accepts the legacy
  single-parameter envelope shape (e.g. `{ args: { session, prompt } }`,
  `{ config: { model } }`, `{ handle: { sessionId } }`,
  `{ session: { sessionId } }`, `{ data: forkData }`). The compiler now
  emits operation payloads unwrapped, and both the ACP stdio adapter
  and the SDK adapter forward the effect payload directly: ACP receives
  it as top-level `params`; the SDK receives it as the operation input.

  Callers dispatching against the Claude Code agent must use the
  unwrapped payload shape — for example, dispatch
  `{ session, prompt }` to `claude-code.plan` instead of
  `{ args: { session, prompt } }`.

- 51d11f5: **BREAKING:** `claude-code.newSession` against the Claude Code SDK
  adapter or the ACP binding now throws an `InvalidPayload` error when
  the payload contains any key other than `model`. Previously such
  payloads (e.g. `{ config: { model: "..." } }`) were silently accepted
  and the adapter fell back to default model selection.

  Dispatch the payload directly — `dispatch(ClaudeCode.newSession({}))`
  or `dispatch(ClaudeCode.newSession({ model: "..." }))`.

### Patch Changes

- Updated dependencies [e7d62c6]
- Updated dependencies [4766e26]
- Updated dependencies [29707e6]
- Updated dependencies [e1e37b2]
- Updated dependencies [51d11f5]
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
  - @tisyn/code-agent@0.3.0
  - @tisyn/effects@0.3.0
  - @tisyn/transport@0.15.0
  - @tisyn/ir@0.15.0
  - @tisyn/protocol@0.15.0

## 0.13.0

### Minor Changes

- a12fefc: Claude Code is now a `CodeAgent` adapter against the shared
  `@tisyn/code-agent` contract. Session, prompt, and fork types
  (`SessionHandle`, `PromptResult`, `ForkData`) are re-exported from the
  shared package instead of being locally redefined, so workflows that
  also drive Codex (or any future `CodeAgent` adapter) can pass the same
  values between them. Adapters now publish `prompt` as a portable alias
  for `plan` on the SDK, ACP, and mock paths; existing `plan` callers
  continue to work unchanged. `PlanResult` extends the shared
  `PromptResult` with Claude-specific `toolResults`.

### Patch Changes

- Updated dependencies [c792d86]
- Updated dependencies [a12fefc]
- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
  - @tisyn/agent@0.14.0
  - @tisyn/code-agent@0.2.0
  - @tisyn/effects@0.2.0
  - @tisyn/transport@0.14.0
  - @tisyn/ir@0.14.0
  - @tisyn/protocol@0.14.0

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
