/**
 * End-to-end: session manager + worker LLM + compiled workflow.
 * A test WebSocket client simulates the browser.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { WebSocketServer, WebSocket } from "ws";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Chat, Llm, chat } from "../src/workflow.generated.js";
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

    // Collect transcript snapshots and auto-respond to elicit
    const transcriptSnapshots: Array<Array<{ role: string; content: string }>> = [];
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

      if (msg.type === "renderTranscript") {
        transcriptSnapshots.push(msg.messages);
      }
    });

    // Send connect message
    clientWs.send(JSON.stringify({ type: "connect", clientSessionId: "e2e-test" }));

    const serverWs = yield* serverConnected.operation;

    // --- Set up agents (same pattern as host.ts) ---
    const session = new BrowserSessionManager();
    session.attach("e2e-test", serverWs);

    // Chat agent — local, backed by session manager
    const chatImpl = implementAgent(Chat(), {
      *elicit({ input }) {
        return yield* session.elicit(input.prompt);
      },
      *renderTranscript({ input }) {
        session.renderTranscript(input.messages);
      },
      *setReadOnly({ input }) {
        session.setReadOnly(input.reason);
      },
    });
    yield* chatImpl.install();

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

    // Wait for transcript containing two turns
    const allTurnsDone = withResolvers<void>();
    const checkDone = () => {
      const latest = transcriptSnapshots[transcriptSnapshots.length - 1];
      if (latest && latest.length >= 4) {
        allTurnsDone.resolve();
      }
    };

    // Poll via the existing message listener — add a second listener
    clientWs.on("message", () => checkDone());
    // Also check now in case messages already arrived
    checkDone();

    yield* allTurnsDone.operation;

    // --- Assertions ---
    const latest = transcriptSnapshots[transcriptSnapshots.length - 1];
    expect(latest).toEqual([
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
