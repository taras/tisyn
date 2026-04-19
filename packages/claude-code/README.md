# `@tisyn/claude-code`

`@tisyn/claude-code` adapts Claude Code to the portable `@tisyn/code-agent` contract.

It lets Tisyn workflows talk to Claude Code through the same session-oriented operations used by other coding-agent backends, while hiding the details of ACP JSON-RPC or the Claude Agent SDK.

## Where It Fits

`@tisyn/claude-code` sits above the portable contract and below transport/session wiring.

- `@tisyn/code-agent` defines the backend-neutral coding-agent contract.
- `@tisyn/claude-code` translates that contract into Claude Code-specific protocols.
- `@tisyn/transport` installs the binding into a Tisyn execution scope.
- `@tisyn/protocol` provides the Tisyn-side execute/progress message shapes the binding emits.

Use this package when you want a Claude-backed implementation of the `CodeAgent` contract.

## What It Provides

The public surface exported from `src/index.ts` includes:

- `createBinding` — create a `LocalAgentBinding` backed by a Claude Code ACP process
- `createSdkBinding` — create a `LocalAgentBinding` backed by the Claude Agent SDK
- `createMockClaudeCodeTransport` — mock transport for tests
- `AcpAdapterConfig` — configuration for the ACP stdio adapter
- `SdkAdapterConfig` — configuration for the SDK-backed adapter
- `SessionHandle`, `PromptResult`, `ForkData` — portable contract types re-exported from `@tisyn/code-agent`
- `PlanResult` — Claude-specific prompt result extension that can include tool results

## Adapter Shapes

### ACP binding

`createBinding()` connects Tisyn protocol messages to a Claude Code ACP stdio process.

It is responsible for:

- spawning or attaching to an ACP process
- translating Tisyn execute requests into ACP JSON-RPC requests
- translating ACP success/error/progress messages back into Tisyn protocol messages
- synthesizing the Tisyn initialize response ACP does not speak natively

### SDK binding

`createSdkBinding()` uses `@anthropic-ai/claude-agent-sdk` directly instead of going through ACP stdio.

It is responsible for:

- creating persistent SDK sessions
- streaming progress events back into the Tisyn protocol shape
- mapping Tisyn operations such as `newSession`, `plan`, `fork`, and `openFork` onto SDK calls

## Relationship to Other Packages

- [`@tisyn/code-agent`](../code-agent/README.md) supplies the contract this package implements.
- [`@tisyn/transport`](../transport/README.md) consumes the returned `LocalAgentBinding`.
- [`@tisyn/protocol`](../protocol/README.md) provides the execute/progress message helpers used on the Tisyn side.
- [`@tisyn/agent`](../agent/README.md) remains the declaration layer; this package is an implementation adapter, not a contract definition package.

## Boundaries

`@tisyn/claude-code` does not:

- define the portable coding-agent contract
- define general Tisyn transport/session semantics
- compile workflows
- own the higher-level review/spec workflows that happen to use Claude Code

It exists specifically to make Claude Code conform to the shared `CodeAgent` surface.
