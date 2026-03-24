/**
 * Multi-Agent Chat Demo — Server Host
 *
 * The host is the sole orchestrator. It:
 * 1. Starts a WebSocket server for the browser agent
 * 2. Spawns a Worker for the LLM agent
 * 3. Installs a local State agent for history management
 * 4. Executes the compiled chat workflow
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { main, spawn, withResolvers, useScope } from "effection";
import { WebSocketServer } from "ws";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { chat } from "./workflow.generated.js";
import { serverWebSocketTransport } from "./browser-transport.js";

// Agent declarations (matching compiler-generated IDs)
const browser = agent("browser", {
  waitForUser: operation<{ input: { prompt: string } }, { message: string }>(),
  showAssistantMessage: operation<{ input: { message: string } }, void>(),
});

const llm = agent("l-l-m", {
  sample: operation<
    {
      input: {
        history: Array<{ role: string; content: string }>;
        message: string;
      };
    },
    { message: string }
  >(),
});

const state = agent("state", {
  getHistory: operation<
    { input: { placeholder: string } },
    Array<{ role: string; content: string }>
  >(),
  recordTurn: operation<{ input: { userMessage: string; assistantMessage: string } }, void>(),
});

await main(function* () {
  const scope = yield* useScope();

  // 1. Start WebSocket server
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  const listening = withResolvers<number>();
  httpServer.listen(3000, () => {
    const addr = httpServer.address() as AddressInfo;
    listening.resolve(addr.port);
  });
  const port = yield* listening.operation;
  console.log(`WebSocket server listening on ws://localhost:${port}`);

  // Wait for browser to connect
  const connected = withResolvers<import("ws").WebSocket>();
  wss.on("connection", (ws) => {
    console.log("Browser connected");
    connected.resolve(ws);
  });

  console.log("Waiting for browser connection...");
  const browserWs = yield* connected.operation;

  // 2. Install browser agent via WebSocket transport
  yield* installRemoteAgent(browser, serverWebSocketTransport(browserWs));
  console.log("Browser agent installed");

  // 3. Install LLM agent via Worker transport
  const llmFactory = workerTransport({
    url: import.meta.resolve("./llm-worker.ts"),
  });
  yield* installRemoteAgent(llm, llmFactory);
  console.log("LLM worker agent installed");

  // 4. Install local State agent
  const history: Array<{ role: string; content: string }> = [];
  const stateImpl = implementAgent(state, {
    *getHistory() {
      return [...history];
    },
    *recordTurn({ input }) {
      history.push(
        { role: "user", content: input.userMessage },
        { role: "assistant", content: input.assistantMessage },
      );
    },
  });
  yield* stateImpl.install();
  console.log("State agent installed");

  // 5. Execute the compiled chat workflow
  console.log("Starting chat workflow...");
  yield* execute({ ir: Call(chat) });
});
