# Multi Code Agent Example

Demonstrates a Tisyn workflow that hands off work between two
CodeAgent backends — Claude Code and Codex — using the shared
`@tisyn/code-agent` contract.

The workflow prompts Claude to analyze a user task, then hands off
Claude's analysis to Codex with an explicit instruction to implement
the described changes.

## Conformance

- **Claude side:** uses the conforming `@tisyn/claude-code` SDK
  adapter, which calls the Claude Agent SDK directly.
- **Codex side:** uses the non-conforming `@tisyn/codex` exec
  adapter, which runs `codex exec --json` as an independent
  subprocess per prompt. This does not preserve session history
  across prompts, but the handoff only requires a single
  self-contained Codex prompt.

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
pnpm exec tsn run src/handoff.ts --task "Refactor the auth module"
```

The workflow prints milestone messages as it advances, followed by
each agent's final response when the step completes. Live backend
token/progress streaming is not part of this example.

```
── Task ──
Refactor the auth module

── Status ──
Opening Claude session...

── Status ──
Requesting Claude analysis...

── Claude ──
<Claude's analysis>

── Status ──
Opening Codex session...

── Status ──
Handing Claude analysis to Codex...

── Codex ──
<Codex's implementation>

── Status ──
Workflow complete.
```

## Architecture

- `src/handoff.ts` — authored workflow with `Claude()`, `Codex()`,
  and `Output()` agent declarations using the portable CodeAgent
  contract types from `@tisyn/code-agent`
- `claude-binding.ts` — Claude Code SDK adapter binding
- `codex-binding.ts` — Codex exec adapter binding (one-shot)
- `src/output-agent.ts` — inprocess agent that prints labeled results
