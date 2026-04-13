import type { Workflow } from "@tisyn/agent";
import { resource, provide } from "@tisyn/agent";
import { workflow, agent, transport, journal } from "@tisyn/config";
import type {
  SessionHandle,
  PromptResult,
  NewSessionConfig,
  PromptArgs,
} from "@tisyn/code-agent";

/**
 * Multi Code Agent handoff — authored workflow example.
 *
 * Demonstrates two portable CodeAgent backends collaborating
 * through a fixed relay:
 *   1. Prompt Claude with the user's task
 *   2. Forward Claude's response to Codex
 *   3. Log both responses
 *
 * The Claude side uses the conforming SDK adapter.
 * The Codex side uses the non-conforming exec adapter — each
 * prompt spawns an independent `codex exec` subprocess. This
 * is suitable here because the handoff only requires a single
 * self-contained Codex prompt.
 */

declare function Claude(): {
  newSession(config: NewSessionConfig): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<null>;
  prompt(args: PromptArgs): Workflow<PromptResult>;
};

declare function Codex(): {
  newSession(config: NewSessionConfig): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<null>;
  prompt(args: PromptArgs): Workflow<PromptResult>;
};

declare function Output(): {
  log(input: { label: string; text: string }): Workflow<void>;
};

function useClaudeSession(config: NewSessionConfig) {
  return resource<SessionHandle>(function* () {
    const handle = yield* Claude().newSession(config);
    try {
      yield* provide(handle);
    } finally {
      yield* Claude().closeSession(handle);
    }
  });
}

function useCodexSession(config: NewSessionConfig) {
  return resource<SessionHandle>(function* () {
    const handle = yield* Codex().newSession(config);
    try {
      yield* provide(handle);
    } finally {
      yield* Codex().closeSession(handle);
    }
  });
}

export function* handoff(input: { task: string }) {
  yield* Output().log({ label: "Task", text: input.task });

  // Phase 1: Claude analyzes the task
  const claudeSession = yield* useClaudeSession({ model: "claude-sonnet-4-6" });
  const claudeResult = yield* Claude().prompt({
    session: claudeSession,
    prompt: `Analyze: ${input.task}`,
  });
  yield* Output().log({ label: "Claude", text: claudeResult.response });

  // Phase 2: Codex implements the changes Claude described
  const codexSession = yield* useCodexSession({});
  const codexResult = yield* Codex().prompt({
    session: codexSession,
    prompt: `Implement the changes described in the following analysis.\n\n${claudeResult.response}`,
  });
  yield* Output().log({ label: "Codex", text: codexResult.response });
}

export default workflow({
  run: { export: "handoff", module: "./handoff.ts" },
  agents: [
    agent("claude", transport.local("../claude-binding.ts")),
    agent("codex", transport.local("../codex-binding.ts")),
    agent("output", transport.inprocess("./output-agent.ts")),
  ],
  journal: journal.memory(),
});
