# Multi Code Agent Example

Demonstrates a Tisyn workflow where two CodeAgent backends — Claude
Code and Codex — have a brief conversational handoff using the shared
`@tisyn/code-agent` contract.

Claude receives the user's task, analyzes it, and its message is
forwarded to Codex. Codex gives a brief reply and suggests a next
step. The example is a lightweight agent-to-agent handoff demo, not
an implementation worker.

## Conformance

- **Claude side:** uses the `@tisyn/claude-code` SDK adapter, which
  calls the Claude Agent SDK directly.
- **Codex side:** uses the `@tisyn/codex` SDK adapter, which calls
  the `@openai/codex-sdk` directly. The SDK maintains per-thread
  conversation history across prompts.

## Prerequisites

1. Install workspace dependencies:

   ```sh
   pnpm install
   ```

2. Authenticate the Claude CLI:

   ```sh
   npx @anthropic-ai/claude-code auth
   ```

3. Install and authenticate the Codex CLI:

   ```sh
   npm install -g @openai/codex
   codex auth
   ```

## Usage

### Compile the workflow

```sh
pnpm exec tsn generate src/handoff.ts -o src/handoff.generated.ts
```

### Run the workflow

```sh
pnpm exec tsn run src/handoff.ts --task "Say hello to the other agent"
```

The workflow prints milestone messages as it advances, then each
agent's response when the step completes. Live backend token streaming
is not part of this example.

```
── Task ──
Say hello to the other agent

── Status ──
Opening Claude session...

── Status ──
Requesting Claude analysis...

── Claude ──
<Claude's message>

── Status ──
Opening Codex session...

── Status ──
Handing Claude message to Codex for a brief reply...

── Codex ──
<Codex's brief reply>

── Status ──
Workflow complete.
```

If Claude returns an empty response, the workflow skips the Codex
handoff and logs a status message explaining why.

## Architecture

- `src/handoff.ts` — authored workflow with `Claude()`, `Codex()`,
  and `Output()` agent declarations using the portable CodeAgent
  contract types from `@tisyn/code-agent`
- `claude-binding.ts` — Claude Code SDK adapter binding
- `codex-binding.ts` — Codex SDK adapter binding
- `src/output-agent.ts` — inprocess agent that prints labeled results
