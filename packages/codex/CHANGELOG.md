# @tisyn/codex

## 0.3.2

### Patch Changes

- Updated dependencies [6c83c81]
  - @tisyn/effects@0.3.2
  - @tisyn/agent@0.17.0
  - @tisyn/code-agent@0.3.2
  - @tisyn/transport@0.17.0
  - @tisyn/ir@0.17.0
  - @tisyn/protocol@0.17.0

## 0.3.1

### Patch Changes

- Updated dependencies [f4012af]
  - @tisyn/transport@0.16.0
  - @tisyn/agent@0.16.0
  - @tisyn/code-agent@0.3.1
  - @tisyn/ir@0.16.0
  - @tisyn/protocol@0.16.0
  - @tisyn/effects@0.3.1

## 0.3.0

### Minor Changes

- 89c8355: **BREAKING:** The Codex adapter no longer accepts the legacy
  single-parameter envelope shape (e.g. `{ args: { session, prompt } }`,
  `{ config: {} }`, `{ handle }`, `{ session }`, `{ data }`). The
  compiler now emits operation payloads unwrapped, and both the SDK
  adapter and the exec adapter forward the effect payload directly to
  the operation handler.

  Callers dispatching against the Codex agent must use the unwrapped
  payload shape — for example, dispatch `{ session, prompt }` to
  `code-agent.prompt` instead of `{ args: { session, prompt } }`.

- 51d11f5: **BREAKING:** `code-agent.newSession` against the Codex SDK adapter
  or the Codex exec adapter now throws an `InvalidPayload` error when
  the payload contains any key other than `model`. Previously such
  payloads (e.g. `{ config: { model: "..." } }`) were silently accepted
  and the adapter fell back to default model selection.

  Dispatch the payload directly — `dispatch(CodeAgent.newSession({}))`
  or `dispatch(CodeAgent.newSession({ model: "..." }))`.

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

## 0.2.0

### Minor Changes

- a12fefc: Workflows can now drive OpenAI Codex through the new `@tisyn/codex`
  package. `createSdkBinding()` is a conforming core-tier `CodeAgent`
  adapter over `@openai/codex-sdk`: `newSession`, `prompt`,
  `closeSession`, and cancellation are validated; per-thread conversation
  history is maintained by the SDK. `createExecBinding()` wraps
  `codex exec --json` as an explicit non-conforming one-shot utility for
  self-contained prompts — each call spawns a fresh subprocess with no
  conversation history. Fork and resume remain unsupported until the
  remaining SDK API questions are resolved.

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
