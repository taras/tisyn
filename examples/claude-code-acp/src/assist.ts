import { type Workflow, resource, provide } from "@tisyn/agent";
import { workflow, agent, transport, journal } from "@tisyn/config";
import type { SessionHandle, PlanResult, ForkData } from "./types.ts";

/**
 * Claude Code ACP integration — authored workflow example.
 *
 * Demonstrates:
 * - Session lifecycle as resource (open/provide/close in finally)
 * - Sequential plan calls on the same session
 *
 * Build: tsn generate src/assist.ts -o src/assist.generated.ts
 */

declare function ClaudeCode(): {
  openSession(config: { model: string }): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<void>;
  plan(args: { session: SessionHandle; prompt: string }): Workflow<PlanResult>;
  fork(session: SessionHandle): Workflow<ForkData>;
  openFork(data: ForkData): Workflow<SessionHandle>;
};

declare function Output(): {
  log(input: { label: string; text: string }): Workflow<void>;
};

function* useClaudeCodeSession(config: { model: string }) {
  return yield* resource<SessionHandle>(function* () {
    const handle = yield* ClaudeCode().openSession(config);
    try {
      yield* provide(handle);
    } finally {
      yield* ClaudeCode().closeSession(handle);
    }
  });
}

export function* assist(input: { task: string }) {
  const session = yield* useClaudeCodeSession({ model: "opus-4" });

  // Sequential plan calls — each is a durable YieldEvent
  const analysis = yield* ClaudeCode().plan({
    session,
    prompt: `Analyze: ${input.task}`,
  });

  yield* Output().log({ label: "Analysis", text: analysis.response });

  const implementation = yield* ClaudeCode().plan({
    session,
    prompt: "Now implement the changes you described.",
  });

  yield* Output().log({ label: "Implementation", text: implementation.response });
}

export default workflow({
  run: { export: "assist", module: "./assist.ts" },
  agents: [
    agent("claude-code", transport.local("../claude-code-binding.ts")),
    agent("output", transport.inprocess("./output-agent.ts")),
  ],
  journal: journal.memory(),
});
