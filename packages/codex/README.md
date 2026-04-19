# `@tisyn/codex`

`@tisyn/codex` adapts OpenAI Codex to the portable `@tisyn/code-agent` contract.

It gives Tisyn workflows a Codex-backed coding-agent implementation without forcing workflow code to know whether Codex is reached through the TypeScript SDK or the `codex exec` CLI.

## Where It Fits

`@tisyn/codex` occupies the same role for Codex that `@tisyn/claude-code` does for Claude Code.

- `@tisyn/code-agent` defines the portable coding-agent contract.
- `@tisyn/codex` implements that contract for Codex.
- `@tisyn/transport` installs the returned binding into a local or remote Tisyn scope.

Use this package when you want Codex to satisfy the standard coding-agent contract used by workflows.

## What It Provides

The public surface exported from `src/index.ts` includes:

- `createSdkBinding` — create a `LocalAgentBinding` backed by `@openai/codex-sdk`
- `createExecBinding` — create a `LocalAgentBinding` backed by `codex exec --json`
- `CodexSdkConfig` — configuration for the SDK-backed adapter
- `CodexExecConfig` — configuration for the CLI-backed adapter
- `SessionHandle`, `PromptResult`, `ForkData` — portable contract types re-exported from `@tisyn/code-agent`

## Adapter Modes

### SDK binding

`createSdkBinding()` is the conforming adapter.

It creates persistent Codex threads and maps the portable contract onto SDK operations such as:

- session creation
- streamed prompt execution
- session close

This is the adapter to use when prompts in the same session must preserve conversation history.

### Exec binding

`createExecBinding()` is a convenience adapter around `codex exec --json`.

It is intentionally weaker:

- each prompt runs in its own subprocess
- no conversation history is preserved between prompts
- it does not fully satisfy the portable `CodeAgent` contract's sequential-session expectations

It is useful for CI-like workflows where each prompt is independent, but it is not the contract-faithful backend.

## Relationship to Other Packages

- [`@tisyn/code-agent`](../code-agent/README.md) defines the contract this package implements.
- [`@tisyn/transport`](../transport/README.md) consumes the returned bindings.
- [`@tisyn/agent`](../agent/README.md) remains the declaration layer beneath the contract.

## Boundaries

`@tisyn/codex` does not:

- define the shared coding-agent contract
- define the Tisyn protocol or session model
- guarantee every Codex invocation mode is equally capable

It exists to make Codex usable behind the `CodeAgent` contract, with the SDK adapter as the primary conforming path.
