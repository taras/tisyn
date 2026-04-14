// Workflow descriptor for the corpus verification pipeline.
//
// Entrypoint for `pnpm exec tsn run
// packages/spec/workflows/verify-corpus.ts --target <name> [--skip-claude]`.
//
// The `run` field uses the explicit `{ export, module }` form so the
// CLI loader routes the workflow body through the authored-TS
// compile path (Rule 3 in `packages/cli/src/load-descriptor.ts`) —
// the two-file split keeps the descriptor free of workflow source
// while still letting `tsn run` compile `verify-corpus.workflow.ts`
// on the fly.
//
// The workflow's input type `{ target: string; skipClaude?: boolean }`
// is surfaced as CLI flags automatically by
// `packages/cli/src/inputs.ts` (`--target <value>` for the required
// string field, `--skip-claude` for the optional boolean), so no flag
// parsing lives in this descriptor.

import { agent, journal, transport, workflow } from "@tisyn/config";

export default workflow({
  run: {
    export: "verifyCorpus",
    module: "./verify-corpus.workflow.ts",
  },
  agents: [
    agent("filesystem", transport.inprocess("./filesystem-agent.ts")),
    agent("output", transport.inprocess("./output-agent.ts")),
    agent("corpus", transport.inprocess("./corpus-agent.ts")),
    agent("claude-code", transport.inprocess("./claude-code-binding.ts")),
  ],
  journal: journal.memory(),
});
