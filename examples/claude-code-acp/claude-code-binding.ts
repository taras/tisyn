import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { SessionHandle, PlanResult, ForkData } from "./src/types.ts";

const ClaudeCode = () =>
  agent("claude-code", {
    newSession: operation<{ config: { model: string } }, SessionHandle>(),
    closeSession: operation<{ handle: SessionHandle }, void>(),
    plan: operation<{ args: { session: SessionHandle; prompt: string } }, PlanResult>(),
    fork: operation<{ session: SessionHandle }, ForkData>(),
    openFork: operation<{ data: ForkData }, SessionHandle>(),
  });

let sessionCounter = 0;

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(ClaudeCode(), {
      *newSession({ config }) {
        sessionCounter++;
        return { sessionId: `mock-session-${sessionCounter}` };
      },
      *closeSession() {},
      *plan({ args }) {
        return { response: `[mock] Plan result for: ${args.prompt}` };
      },
      *fork({ session }) {
        return { parentSessionId: session.sessionId, forkId: `fork-${Date.now()}` };
      },
      *openFork() {
        sessionCounter++;
        return { sessionId: `mock-session-${sessionCounter}` };
      },
    }),
  };
}
