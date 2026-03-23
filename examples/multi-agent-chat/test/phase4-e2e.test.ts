/**
 * Phase 4: Full end-to-end test.
 *
 * Wires together: browser agent (WebSocket transport) + LLM agent (Worker) +
 * State agent (local) + compiled chat workflow. A test WebSocket client
 * simulates the browser.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers, useScope } from "effection";
import { WebSocketServer, WebSocket } from "ws";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import type { ExecuteRequest } from "@tisyn/protocol";
import { chat } from "../src/workflow.generated.js";
import { serverWebSocketTransport } from "../src/browser-transport.js";

// Agent declarations
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
  recordTurn: operation<
    { input: { userMessage: string; assistantMessage: string } },
    void
  >(),
});

describe("Phase 4: Full end-to-end", () => {
  it("multi-turn chat: browser → host → worker → browser, with history", function* () {
    const scope = yield* useScope();

    // --- Server setup ---
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    const listening = withResolvers<number>();
    httpServer.listen(0, () => {
      listening.resolve((httpServer.address() as AddressInfo).port);
    });
    const port = yield* listening.operation;

    const connected = withResolvers<import("ws").WebSocket>();
    wss.on("connection", (ws) => connected.resolve(ws));

    // --- Client setup (simulated browser) ---
    const clientWs = new WebSocket(`ws://localhost:${port}`);
    const clientOpen = withResolvers<void>();
    clientWs.on("open", () => clientOpen.resolve());
    yield* clientOpen.operation;

    // Collect showAssistantMessage payloads for assertions
    const assistantMessages: string[] = [];
    // Track LLM sample calls to verify history
    const sampleHistory: Array<Array<{ role: string; content: string }>> = [];

    // Simulated user inputs — after these, reject to end the loop
    const userInputs = ["hello", "how are you?"];
    let inputIndex = 0;

    // Client protocol handler
    clientWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.method === "initialize") {
        clientWs.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: "1.0", sessionId: "e2e-session" },
          }),
        );
        return;
      }

      if (msg.method === "execute") {
        const req = msg as ExecuteRequest;

        if (req.params.operation === "waitForUser") {
          if (inputIndex >= userInputs.length) {
            // Reject to end the workflow
            clientWs.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                  ok: false,
                  error: { message: "done", name: "TestDone" },
                },
              }),
            );
            return;
          }
          clientWs.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                ok: true,
                value: { message: userInputs[inputIndex++] },
              },
            }),
          );
          return;
        }

        if (req.params.operation === "showAssistantMessage") {
          assistantMessages.push(req.params.args[0]?.input?.message ?? "");
          clientWs.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { ok: true, value: null },
            }),
          );
          return;
        }
      }
    });

    const serverWs = yield* connected.operation;

    // --- Install agents ---

    // Browser agent via WebSocket
    yield* installRemoteAgent(browser, serverWebSocketTransport(serverWs));

    // LLM agent via Worker
    const llmFactory = workerTransport({
      url: import.meta.resolve("../src/llm-worker.ts"),
    });
    yield* installRemoteAgent(llm, llmFactory);

    // State agent (local)
    const history: Array<{ role: string; content: string }> = [];
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
      try {
        yield* execute({ ir: Call(chat as never) });
      } catch {
        // Expected: workflow errors when browser rejects waitForUser
      }
      workflowDone.resolve();
    });

    yield* workflowDone.operation;

    // --- Assertions ---

    // Two assistant messages were displayed
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toBe("Echo: hello");
    expect(assistantMessages[1]).toBe("Echo: how are you?");

    // History accumulated across turns
    // Turn 1: getHistory returned empty
    expect(sampleHistory[0]).toEqual([]);
    // Turn 2: getHistory returned entries from turn 1
    expect(sampleHistory[1]).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    ]);

    // Final history has all entries
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
