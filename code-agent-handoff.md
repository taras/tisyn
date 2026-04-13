# Code Agent / Codex Handoff

You are working in:

`/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/code-agent-handoff`

Branch:

`code-agent-handoff`

Base commit:

`14917df`

## Source Docs

Read these first:

- `code-agent-specification.source.md`
- `code-agent-test-plan.source.md`
- `codex-specification.source.md`

Treat those three documents as the source of truth. This handoff narrows them to the current repo and separates required implementation from still-provisional profile claims.

## Goal

Land the first repo pass of the `CodeAgent` feature centered on:

1. a new shared portable contract package, `@tisyn/code-agent`
2. a new Codex adapter package, `@tisyn/codex`
3. minimal alignment of the existing `@tisyn/claude-code` package with that shared contract

The intended outcome is a real contract surface plus a Codex-backed implementation path, not just imported docs.

## Current Repo Facts

- There is no existing `packages/code-agent` package.
- There is no existing `packages/codex` package.
- The repo currently has no Codex references in `package.json`, `pnpm-lock.yaml`, or `packages/`.
- The closest portable-contract template is the Browser contract:
  - spec: `specs/tisyn-browser-contract-specification.md`
  - test plan: `specs/tisyn-browser-contract-test-plan.md`
  - compiler acceptance: `packages/transport/src/transports/browser-contract.test.ts`
  - runtime/replay tests: `packages/transport/src/transports/browser-scope.test.ts`
- The closest adapter template is `@tisyn/claude-code`:
  - `packages/claude-code/src/index.ts`
  - `packages/claude-code/src/sdk-adapter.ts`
  - `packages/claude-code/src/acp-adapter.ts`
  - `packages/claude-code/src/mock.ts`
  - `packages/claude-code/src/claude-code.test.ts`
- `packages/transport` already has the session, progress, cancellation, and protocol plumbing that coding-agent adapters should reuse.
- `packages/cli` already supports `transport.local()` modules exporting `createBinding()`.
- The base `CodeAgent` spec explicitly does not require compiler, kernel, IR, or config architecture changes.
- The existing Claude Code package predates the shared contract. The imported spec says it should be aligned to the contract rather than treated as the contract itself.

## Required Outcome

### 1. Add `@tisyn/code-agent`

Create a shared contract package that owns the portable `CodeAgent` surface and shared types:

- `SessionHandle`
- `PromptResult`
- `ForkData`

The package should give adapters and tests one canonical place for the contract surface. Follow existing repo conventions for transport-bound agents rather than inventing a new subsystem.

Keep this package portable and contract-focused:

- no backend-specific config
- no Codex-specific result fields
- no Claude-specific aliases
- no compiler syntax changes

### 2. Add `@tisyn/codex`

Create a new Codex adapter package with two entry points:

- `createSdkBinding(config?)`
- `createExecBinding(config?)`

The profile spec is explicit about their status:

- `createSdkBinding` is the intended conforming path, but only if the real SDK can be verified to preserve sequential prompt history.
- `createExecBinding` is explicitly non-conforming and must remain documented and tested as such.

Required Codex behavior for the first pass:

- adapter-internal `cx-*` handle allocation
- headless config validation:
  - approval only `"on-request"` or `"never"`
  - sandbox only `"read-only"`, `"workspace-write"`, or `"danger-full-access"`
- `closeSession` stale-handle tolerance
- `prompt` stale-handle failure
- progress forwarding
- cancellation propagation
- subprocess / SDK diagnostic surfacing

For extended-tier operations:

- do not fabricate `fork` / `openFork`
- if SDK support is absent or still unverified, throw `"NotSupported"`
- do not claim extended-tier conformance unless it is actually implemented and tested

### 3. Align `@tisyn/claude-code` with the shared contract

Do the smallest alignment that makes the package subordinate to `CodeAgent` instead of acting like a standalone incompatible surface.

That means:

- accept `prompt` as the contract operation resolving identically to the existing `plan` behavior
- preserve `plan` as a Claude-specific alias
- treat `toolResults` as a non-portable extension, not a contract field
- reuse shared contract types where that can be done without destabilizing the package

Do not turn this into a full Claude Code rewrite. Keep the pass narrow and mechanical.

## Likely Code Areas

New:

- `packages/code-agent/`
- `packages/codex/`

Likely shared-package files:

- `packages/code-agent/package.json`
- `packages/code-agent/src/index.ts`
- `packages/code-agent/src/types.ts`
- `packages/code-agent/src/code-agent.ts`

Likely Codex files:

- `packages/codex/package.json`
- `packages/codex/src/index.ts`
- `packages/codex/src/sdk-adapter.ts`
- `packages/codex/src/exec-adapter.ts`
- `packages/codex/src/mock.ts`
- `packages/codex/src/codex.test.ts`

Likely follow-up touches:

- `packages/claude-code/src/index.ts`
- `packages/claude-code/src/sdk-adapter.ts`
- `packages/claude-code/src/acp-adapter.ts`
- `packages/claude-code/src/types.ts`
- `packages/claude-code/src/claude-code.test.ts`
- root `README.md`

## Implementation Defaults

### 1. Shared contract first

Define the contract once in `@tisyn/code-agent` and make adapters conform to it. Do not duplicate operation names and types separately in each adapter package if the shared package can own them cleanly.

### 2. Treat Browser as the structural pattern

The Browser contract is the best existing example of:

- a transport-bound agent contract
- a narrow portable surface
- compiler acceptance without custom compiler rules
- runtime/replay testing without new architecture

Match that pattern. `CodeAgent` should be another transport-bound contract at the same architectural level, not a special subsystem.

### 3. Treat Claude Code as the adapter pattern

`@tisyn/claude-code` already demonstrates:

- `LocalAgentBinding` entry points
- synthetic initialize handling
- parameter unwrapping
- operation-name stripping
- progress forwarding
- cancellation wiring
- mock-backed tests

Reuse that shape where practical instead of designing a brand-new adapter style for Codex.

### 4. Do not fake the Codex SDK

The Codex profile repeatedly marks the SDK mapping as provisional.

If the actual `@openai/codex-sdk` API cannot be verified:

- do not invent method names
- do not claim core-tier conformance for the SDK path
- keep the implementation honest about what is validated versus still blocked

If necessary, land the shared contract plus the explicit non-conforming exec utility and leave the SDK path clearly marked as blocked by real API verification. Do not blur that line.

## Test Bar

At minimum, the implementation should cover four buckets:

1. Shared contract behavior:
   portable operation/result types and any contract-level helpers

2. Codex profile behavior:
   config validation, stale-handle rules, progress/cancellation behavior, non-conforming exec classification, and any validated SDK path behavior

3. Claude Code compatibility:
   contract `prompt` path plus preserved `plan` alias behavior

4. Documentation-level honesty:
   tests and docs must not present non-conforming `createExecBinding` as conforming

Use mock transports / fake backends for conformance-style tests. Do not make real Codex or network access a prerequisite for the normal test suite.

## Verification

Run the narrowest relevant package tests first:

```bash
pnpm --filter @tisyn/code-agent test
pnpm --filter @tisyn/codex test
pnpm --filter @tisyn/claude-code test
```

Broaden only if you touch shared infrastructure outside those packages.

## Guardrails

- Do not add compiler syntax or authored-language changes.
- Do not add new runtime persistence or replay mechanisms.
- Do not redefine contract types inside `@tisyn/codex`.
- Do not present `createExecBinding` as conforming.
- Do not claim extended-tier Codex support unless `fork` / `openFork` are actually implemented and verified.
- Do not let Claude-specific `plan` or `toolResults` leak into the portable contract.
- Do not move these imported source docs into `specs/` during this pass.

## Deliverables

Produce:

1. the implementation patch
2. the three imported source docs kept in this worktree
3. a short change summary that distinguishes:
   - shared contract work
   - Codex profile work
   - Claude Code alignment work
4. test results for the touched package suites

## Done Means

The branch is done when a reader can verify that:

- Tisyn now has a shared `CodeAgent` contract package
- Codex support exists as a concrete package instead of only a draft spec
- the conforming versus non-conforming Codex paths are stated and tested honestly
- Claude Code is aligned as a profile under the shared contract
- no compiler/runtime architecture churn was introduced just to support this feature
