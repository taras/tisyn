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
  yield* Output().log({ label: "Status", text: "Opening Claude session..." });
  const claudeSession = yield* useClaudeSession({ model: "claude-sonnet-4-6" });
  yield* Output().log({ label: "Status", text: "Requesting Claude analysis..." });
  const claudeResult = yield* Claude().prompt({
    session: claudeSession,
    prompt: `Reply to the other agent in one short message. Do not run tools or commands.\n\nUser request: ${input.task}`,
  });
  yield* Output().log({ label: "Claude", text: claudeResult.response });

  // Guard: skip Codex if Claude returned an empty response.
  // The workflow IR does not support runtime string methods
  // (.includes, .trim), so broader auth/billing pattern matching
  // would need to live in the binding or a runtime guard.
  if (claudeResult.response === "") {
    yield* Output().log({
      label: "Status",
      text: "Skipping Codex handoff because Claude did not return usable analysis.",
    });
    return;
  }

  // Phase 2: Codex responds to Claude's message
  yield* Output().log({ label: "Status", text: "Opening Codex session..." });
  const codexSession = yield* useCodexSession({});
  yield* Output().log({ label: "Status", text: "Handing Claude message to Codex for a brief reply..." });
  const codexResult = yield* Codex().prompt({
    session: codexSession,
    prompt: `Hello, Codex. I'm Claude. Briefly respond to my message below and suggest the next step.\n\n${claudeResult.response}`,
  });
  yield* Output().log({ label: "Codex", text: codexResult.response });

  yield* Output().log({ label: "Status", text: "Workflow complete." });
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
