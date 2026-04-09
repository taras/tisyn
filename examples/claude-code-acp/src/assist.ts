/**
 * Claude Code ACP integration — authored workflow example.
 *
 * Demonstrates:
 * - Session lifecycle as resource (open/provide/close in finally)
 * - Sequential plan calls on the same session
 * - Fork with child session
 */

interface SessionHandle {
  sessionId: string;
}

interface PlanResult {
  response: string;
  toolResults?: Array<{ tool: string; output: unknown }>;
}

interface ForkData {
  parentSessionId: string;
  forkId: string;
}

declare function ClaudeCode(): {
  openSession(config: { model: string }): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<void>;
  plan(args: { session: SessionHandle; prompt: string }): Workflow<PlanResult>;
  fork(session: SessionHandle): Workflow<ForkData>;
  openFork(data: ForkData): Workflow<SessionHandle>;
};

export function* assist(input: { task: string }) {
  // Session as resource — init opens, finally closes
  const session = yield* resource(function* () {
    const handle = yield* ClaudeCode().openSession({ model: "opus-4" });
    try {
      yield* provide(handle);
    } finally {
      yield* ClaudeCode().closeSession(handle);
    }
  });

  // Sequential plan calls — each is a durable YieldEvent
  const analysis = yield* ClaudeCode().plan({
    session,
    prompt: `Analyze: ${input.task}`,
  });

  const implementation = yield* ClaudeCode().plan({
    session,
    prompt: "Now implement the changes you described.",
  });

  return {
    analysis: analysis.response,
    implementation: implementation.response,
  };
}
