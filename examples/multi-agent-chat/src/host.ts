/**
 * Multi-Agent Chat Demo — Server Host
 *
 * The host is the sole orchestrator. It:
 * 1. Starts a WebSocket server for the browser agent
 * 2. Spawns a Worker for the LLM agent
 * 3. Installs a local State agent for history management
 * 4. Executes the compiled chat workflow
 */

import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Browser, chat, Llm, State } from "./workflow.generated.js";
import {
  serverWebSocketTransport,
  useWebSocketServer,
} from "./browser-transport.js";
import { main } from "effection";

await main(function* () {
  const browserWs = yield* useWebSocketServer();

  yield* installRemoteAgent(Browser(), serverWebSocketTransport(browserWs));
  console.log("Browser agent installed");

  const llmTransport = workerTransport({
    url: import.meta.resolve("./llm-worker.ts"),
  });

  yield* installRemoteAgent(Llm(), llmTransport);
  console.log("LLM worker agent installed");

  const history: Array<{ role: string; content: string }> = [];
  const stateImpl = implementAgent(State(), {
    *getHistory() {
      return [...history];
    },
    *recordTurn({ input }) {
      history.push(
        { role: "user", content: input.userMessage },
        { role: "assistant", content: input.assistantMessage }
      );
    },
  });

  yield* stateImpl.install();
  console.log("State agent installed");

  // 5. Execute the compiled chat workflow
  console.log("Starting chat workflow...");
  yield* execute({ ir: Call(chat) });
});
