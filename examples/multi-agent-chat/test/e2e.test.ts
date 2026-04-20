/**
 * End-to-end: session manager + worker LLM + compiled workflow.
 * A test WebSocket client simulates the browser.
 *
 * Three agents: App (browser boundary), Llm (worker), DB (in-memory stub).
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { createSignal, spawn, withResolvers } from "effection";
import { WebSocketServer, WebSocket } from "ws";
import { Agents } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent } from "@tisyn/transport";
import { workerTransport } from "@tisyn/transport/worker";
import { Call } from "@tisyn/ir";
import { App, Llm, DB, chat } from "../src/workflow.generated.js";
import { BrowserSessionManager } from "../src/browser-session.js";
import type { HostToBrowser } from "../src/browser-session.js";

describe("End-to-end chat", () => {
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

    // Collect messages from host and auto-respond to elicit
    const assistantMessages: string[] = [];
    const userInputs = ["hello", "how are you?"];
    let inputIndex = 0;

    clientWs.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as HostToBrowser;

      if (msg.type === "elicit") {
        if (inputIndex < userInputs.length) {
          clientWs.send(JSON.stringify({ type: "userMessage", message: userInputs[inputIndex++] }));
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
    const userInput = createSignal<string, never>();
    const session = new BrowserSessionManager(userInput);
    session.attach("e2e-test", serverWs);

    // App agent — local, backed by session manager + signal
    yield* Agents.use(App(), {
      *elicit({ message }) {
        const sub = yield* userInput;
        session.beginElicit(message);
        try {
          const item = yield* sub.next();
          return { message: item.value };
        } finally {
          session.endElicit();
        }
      },
      *showAssistantMessage({ message }) {
        session.showAssistantMessage(message);
      },
      *loadChat(messages) {
        session.loadChat(messages);
      },
      *setReadOnly({ reason }) {
        session.setReadOnly(reason);
      },
    });

    // DB agent — in-memory stub
    yield* Agents.use(DB(), {
      *loadMessages() {
        return [];
      },
      *appendMessage() {
        // no-op for test
      },
    });

    // LLM agent via Worker
    const llmFactory = workerTransport({
      url: new URL("../src/llm-worker.ts", import.meta.url).href,
    });
    yield* installRemoteAgent(Llm(), llmFactory);

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

    // Cleanup
    clientWs.close();
    wss.clients.forEach((c) => c.close());
    wss.close();
    const closed = withResolvers<void>();
    httpServer.close(() => closed.resolve());
    yield* closed.operation;
  });
});
