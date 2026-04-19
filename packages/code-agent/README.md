# `@tisyn/code-agent`

`@tisyn/code-agent` defines the portable agent contract for session-oriented coding agents.

It gives Tisyn workflows one stable capability surface for "open a coding session, send a prompt, fork it, resume it, close it" without baking any particular backend into the workflow. Concrete backends such as Claude Code or Codex implement this contract in separate packages.

## Where It Fits

`@tisyn/code-agent` sits between authored workflows and backend-specific adapter packages.

- `@tisyn/agent` provides the typed declaration machinery used to define the contract.
- `@tisyn/code-agent` names the portable operations and shared result types.
- `@tisyn/claude-code` and `@tisyn/codex` adapt real coding-agent backends to this contract.
- `@tisyn/transport` installs those adapters as local or remote capabilities.

Use this package when workflow code should depend on a generic "coding agent" capability instead of a specific vendor.

## What It Provides

The public surface exported from `src/index.ts` includes:

- `CodeAgent` — the portable declared agent contract with `newSession`, `closeSession`, `prompt`, `fork`, and `openFork`
- `SessionHandle` — workflow-visible session identifier
- `PromptResult` — standard result for prompt operations
- `ForkData` — handle data needed to reopen a forked session
- `NewSessionConfig` — portable new-session input shape
- `PromptArgs` — portable prompt input shape
- `createMockCodeAgentTransport` — test helper for mocking a conforming code-agent transport
- `MockCodeAgentConfig`, `MockOperationConfig` — mock transport configuration types

## Contract Shape

`CodeAgent` is declared as a normal Tisyn agent:

- `newSession(config)` — create a backend session and return a `SessionHandle`
- `closeSession(handle)` — close a session
- `prompt(args)` — send a prompt to an existing session and return `PromptResult`
- `fork(session)` — fork an existing session and return `ForkData`
- `openFork(data)` — reopen a previously created fork and return a new `SessionHandle`

The types in this package are intentionally small and portable. Backend-specific extensions belong in adapter packages, not in the shared contract.

## Relationship to Other Packages

- [`@tisyn/agent`](../agent/README.md) supplies the declaration and operation primitives.
- [`@tisyn/claude-code`](../claude-code/README.md) implements this contract for Claude Code.
- [`@tisyn/codex`](../codex/README.md) implements this contract for Codex.
- [`@tisyn/transport`](../transport/README.md) carries these declared operations across local or remote boundaries.

## Boundaries

`@tisyn/code-agent` does not:

- spawn subprocesses
- speak vendor protocols
- manage stdio or SDK integration
- define vendor-specific result extensions

It only defines the shared coding-agent contract that adapters implement.
