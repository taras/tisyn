/**
 * Phase 3: Browser agent via WebSocket transport.
 *
 * The browser agent is installed on the host via installRemoteAgent()
 * using a server-side WebSocket transport wrapper. A test WebSocket client
 * simulates the browser by implementing the JSON-RPC agent protocol.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { useScope, withResolvers } from "effection";
import { WebSocketServer, WebSocket } from "ws";
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import type { ExecuteRequest } from "@tisyn/protocol";
import { serverWebSocketTransport } from "../src/browser-transport.js";

// Browser agent declaration (matching compiler-generated agent ID)
const browser = agent("browser", {
  waitForUser: operation<{ input: { prompt: string } }, { message: string }>(),
  showAssistantMessage: operation<{ input: { message: string } }, void>(),
});

describe("Phase 3: Browser agent via WebSocket transport", () => {
  it("waitForUser: host request reaches browser, browser response reaches host", function* () {
    const scope = yield* useScope();

    // Start HTTP + WebSocket server
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    const listening = withResolvers<number>();
    httpServer.listen(0, () => {
      const addr = httpServer.address() as AddressInfo;
      listening.resolve(addr.port);
    });
    const port = yield* listening.operation;

    // Wait for browser (test client) to connect
    const connected = withResolvers<WebSocket>();
    wss.on("connection", (ws) => connected.resolve(ws));

    // Connect test client (simulating browser)
    const clientWs = new WebSocket(`ws://localhost:${port}`);
    const clientOpen = withResolvers<void>();
    clientWs.on("open", () => clientOpen.resolve());
    yield* clientOpen.operation;

    // Track messages the client receives
    const clientMessages: unknown[] = [];

    // Set up the client message handler BEFORE installRemoteAgent
    // because installRemoteAgent blocks waiting for initialize response
    clientWs.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      clientMessages.push(msg);

      if (msg.method === "initialize") {
        clientWs.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "1.0",
              sessionId: "test-session-1",
            },
          }),
        );
      } else if (msg.method === "execute") {
        const req = msg as ExecuteRequest;
        if (req.params.operation === "waitForUser") {
          clientWs.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { ok: true, value: { message: "hello from browser" } },
            }),
          );
        } else if (req.params.operation === "showAssistantMessage") {
          clientWs.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { ok: true, value: null },
            }),
          );
        }
      }
    });

    const serverWs = yield* connected.operation;

    // Install browser as a remote agent via the server-side transport
    yield* installRemoteAgent(browser, serverWebSocketTransport(serverWs));

    // Host invokes browser agent operations
    const userResult = yield* invoke(browser.waitForUser({ input: { prompt: "Say something" } }));
    expect(userResult).toEqual({ message: "hello from browser" });

    // Verify the client received an execute request for waitForUser
    const waitForUserMsgs = clientMessages.filter(
      (m: any) => m.method === "execute" && m.params.operation === "waitForUser",
    );
    expect(waitForUserMsgs).toHaveLength(1);

    // Host sends assistant message through the browser agent
    const showResult = yield* invoke(
      browser.showAssistantMessage({ input: { message: "Echo: hello" } }),
    );
    expect(showResult).toBeNull();

    // Verify the client received the showAssistantMessage request
    const showMsgs = clientMessages.filter(
      (m: any) => m.method === "execute" && m.params.operation === "showAssistantMessage",
    );
    expect(showMsgs).toHaveLength(1);
    expect((showMsgs[0] as any).params.args[0].input.message).toBe("Echo: hello");

    // Cleanup
    clientWs.close();
    wss.clients.forEach((c) => c.close());
    wss.close();
    const closed = withResolvers<void>();
    httpServer.close(() => closed.resolve());
    yield* closed.operation;
  });
});
