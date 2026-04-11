# Claude Code ACP Example

Demonstrates a Tisyn workflow that drives Claude Code through the
`@anthropic-ai/claude-agent-sdk` TypeScript API.

## Prerequisites

1. Install workspace dependencies:

   ```sh
   pnpm install
   ```

2. Authenticate the Claude CLI:

   ```sh
   npx @anthropic-ai/claude-code auth
   ```

   The example sends requests to Claude and requires valid credentials.

## Usage

### Compile the workflow

```sh
pnpm exec tsn generate src/assist.ts -o src/assist.generated.ts
```

### Run the workflow

```sh
pnpm exec tsn run src/assist.ts --task "hello world"
```

The output agent prints Claude's analysis and implementation responses
to the console.

## Architecture

- `src/assist.ts` — authored workflow with `ClaudeCode()` and `Output()`
  agent contracts
- `src/assist.generated.ts` — compiled Tisyn IR (auto-generated)
- `src/output-agent.ts` — inprocess agent that prints results to stdout
- `claude-code-binding.ts` — thin wrapper around `@tisyn/claude-code`'s
  `createSdkBinding()`, configured with model and working directory

## Note on mocks

Mock transports and the mock ACP subprocess server live in the
`@tisyn/claude-code` package test infrastructure
(`packages/claude-code/src/mock.ts` and
`packages/claude-code/src/test-assets/mock-acp-server.ts`). This
example exercises the real Claude SDK integration and does not use
mocks at runtime.
