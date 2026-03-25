/**
 * Phase 4: Full end-to-end test.
 *
 * Wires together: local Browser agent (BrowserSessionManager) + LLM agent
 * (Worker) + State agent (local) + compiled chat workflow. A test WebSocket
 * client simulates the browser using the simple message protocol.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { WebSocketServer, WebSocket } from "ws";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { chat } from "../src/workflow.generated.js";
import { BrowserSessionManager } from "../src/browser-session.js";
import type { HostToBrowser } from "../src/browser-session.js";

// Agent declarations
const llm = agent("llm", {
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

const browser = agent("browser", {
  waitForUser: operation<{ input: { prompt: string } }, { message: string }>(),
  showAssistantMessage: operation<{ input: { message: string } }, void>(),
  hydrateTranscript: operation<
    { input: { messages: Array<{ role: string; content: string }> } },
    void
  >(),
  setReadOnly: operation<{ input: { reason: string } }, void>(),
});

describe("Phase 4: Full end-to-end", () => {
  it("multi-turn chat via session manager + worker LLM", function* () {
    // --- WebSocket server for test ---
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    const listening = withResolvers<number>();
    httpServer.listen(0, () => {
      listening.resolve((httpServer.address() as AddressInfo).port);
    });
    const port = yield* listening.operation;

    const serverConnected = withResolvers<import("ws").WebSocket>();
    wss.on("connection", (ws) => serverConnected.resolve(ws));

    // --- Simulated browser client ---
    const clientWs = new WebSocket(`ws://localhost:${port}`);
    const clientOpen = withResolvers<void>();
    clientWs.on("open", () => clientOpen.resolve());
    yield* clientOpen.operation;

    // Collect messages from host and auto-respond to waitForUser
    const assistantMessages: string[] = [];
    const userInputs = ["hello", "how are you?"];
    let inputIndex = 0;

    clientWs.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as HostToBrowser;

      if (msg.type === "waitForUser") {
        if (inputIndex < userInputs.length) {
          clientWs.send(
            JSON.stringify({ type: "userMessage", message: userInputs[inputIndex++] }),
          );
        }
        // After all inputs exhausted, just don't respond — workflow stays blocked
      }

      if (msg.type === "assistantMessage") {
        assistantMessages.push(msg.message);
      }
    });

    // Send connect message
    clientWs.send(JSON.stringify({ type: "connect", clientSessionId: "e2e-test" }));

    const serverWs = yield* serverConnected.operation;

    // --- Set up agents (same pattern as host.ts) ---
    const history: Array<{ role: string; content: string }> = [];
    const sampleHistory: Array<Array<{ role: string; content: string }>> = [];

    const session = new BrowserSessionManager(history);
    session.attach("e2e-test", serverWs);

    // Browser agent — local, backed by session manager
    const browserImpl = implementAgent(browser, {
      *waitForUser({ input }) {
        return yield* session.waitForUser(input.prompt);
      },
      *showAssistantMessage({ input }) {
        session.showAssistantMessage(input.message);
      },
      *hydrateTranscript() {
        // no-op
      },
      *setReadOnly({ input }) {
        session.setReadOnly(input.reason);
      },
    });
    yield* browserImpl.install();

    // LLM agent via Worker
    const llmFactory = workerTransport({
      url: new URL("../src/llm-worker.ts", import.meta.url).href,
    });
    yield* installRemoteAgent(llm, llmFactory);

    // State agent (local)
    const stateImpl = implementAgent(state, {
      *getHistory() {
        sampleHistory.push([...history]);
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

    // --- Execute workflow ---
    const workflowDone = withResolvers<void>();

    yield* spawn(function* () {
      yield* execute({ ir: Call(chat) });
      workflowDone.resolve();
    });

    // Wait for 2 turns to complete (2 assistantMessages)
    const allTurnsDone = withResolvers<void>();
    const checkDone = () => {
      if (assistantMessages.length >= 2) {
        allTurnsDone.resolve();
      }
    };

    // Poll via the existing message listener — add a second listener
    clientWs.on("message", () => checkDone());
    // Also check now in case messages already arrived
    checkDone();

    yield* allTurnsDone.operation;

    // --- Assertions ---
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toBe("Echo: hello");
    expect(assistantMessages[1]).toBe("Echo: how are you?");

    // History accumulated across turns
    expect(sampleHistory[0]).toEqual([]);
    expect(sampleHistory[1]).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    ]);

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
      { role: "user", content: "how are you?" },
      { role: "assistant", content: "Echo: how are you?" },
    ]);

    // Cleanup
    clientWs.close();
    wss.clients.forEach((c) => c.close());
    wss.close();
    const closed = withResolvers<void>();
    httpServer.close(() => closed.resolve());
    yield* closed.operation;
  });
});
