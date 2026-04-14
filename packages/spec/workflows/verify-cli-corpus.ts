// Workflow descriptor for the tisyn-cli corpus verification pipeline.
//
// Entrypoint for `pnpm exec tsn run
// packages/spec/workflows/verify-cli-corpus.ts [--skip-claude]`.
//
// The `run` field uses the explicit `{ export, module }` form so the
// CLI loader routes the workflow body through the authored-TS
// compile path (Rule 3 in `packages/cli/src/load-descriptor.ts`) —
// the two-file split keeps the descriptor free of workflow source
// while still letting `tsn run` compile `verify-cli-corpus.workflow.ts`
// on the fly.

import { agent, journal, transport, workflow } from "@tisyn/config";

export default workflow({
  run: {
    export: "verifyCliCorpus",
    module: "./verify-cli-corpus.workflow.ts",
  },
  agents: [
    agent("filesystem", transport.inprocess("./filesystem-agent.ts")),
    agent("output", transport.inprocess("./output-agent.ts")),
    agent("corpus", transport.inprocess("./corpus-agent.ts")),
    agent("claude-code", transport.inprocess("./claude-code-binding.ts")),
  ],
  journal: journal.memory(),
});
