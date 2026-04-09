import { type Workflow, resource, provide } from "@tisyn/agent";
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

export function* assist(input: { task: string }) {
  // Session as resource — init opens, finally closes
  const session = yield* resource<SessionHandle>(function* () {
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

  yield* Output().log({ label: "Analysis", text: analysis.response });

  const implementation = yield* ClaudeCode().plan({
    session,
    prompt: "Now implement the changes you described.",
  });

  yield* Output().log({ label: "Implementation", text: implementation.response });
}
