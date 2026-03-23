import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { resource, useScope, withResolvers, createQueue, scoped, spawn } from "effection";
import { WebSocketServer } from "ws";
import type { HostMessage } from "@tisyn/protocol";
import { parseHostMessage } from "@tisyn/protocol";
import { agent, operation, invoke, implementAgent } from "@tisyn/agent";
import { installRemoteAgent } from "../install-remote.js";
import { createProtocolServer } from "../protocol-server.js";
import { transportComplianceSuite } from "../transport-compliance.js";
import type { TransportFactoryBuilder } from "../transport-compliance.js";
import { websocketTransport } from "./websocket.js";

// ---------------------------------------------------------------------------
// Part A: Compliance suite
// ---------------------------------------------------------------------------

const websocketBuilder: TransportFactoryBuilder = (declaration, handlers) => {
  return () =>
    resource(function* (provide) {
      const scope = yield* useScope();
      const httpServer = createServer();
      const wss = new WebSocketServer({ server: httpServer });

      const listening = withResolvers<number>();
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        listening.resolve(addr.port);
      });
      const port = yield* listening.operation;

      wss.on("connection", (rawWs) => {
        // Buffer messages synchronously so nothing is lost before
        // the effection task subscribes.
        const queue = createQueue<HostMessage, void>();
        rawWs.on("message", (data) => {
          queue.add(parseHostMessage(JSON.parse(data.toString())));
        });
        rawWs.on("close", () => queue.close());

        const impl = implementAgent(declaration, handlers);
        const server = createProtocolServer(impl);

        scope.run(function* () {
          yield* server.use({
            receive: queue,
            *send(msg) {
              rawWs.send(JSON.stringify(msg));
            },
          });
        });
      });

      const innerFactory = websocketTransport({ url: `ws://localhost:${port}` });
      const transport = yield* innerFactory();

      try {
        yield* provide(transport);
      } finally {
        // Close all ws connections first so httpServer.close() can drain
        wss.clients.forEach((c) => c.close());
        wss.close();
        const closed = withResolvers<void>();
        httpServer.close(() => closed.resolve());
        yield* closed.operation;
      }
    });
};

transportComplianceSuite("websocket", websocketBuilder);

// ---------------------------------------------------------------------------
// Part B: WebSocket-specific tests
// ---------------------------------------------------------------------------

describe("websocket transport specific", () => {
  it("handles concurrent requests", function* () {
    const math = agent("math-concurrent", {
      double: operation<{ value: number }, number>(),
    });

    const factory = websocketBuilder(math, {
      *double({ value }) {
        return value * 2;
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(math, factory);

      const tasks = [];
      for (let i = 1; i <= 5; i++) {
        tasks.push(
          yield* spawn(function* () {
            return yield* invoke(math.double({ value: i }));
          }),
        );
      }

      const results = [];
      for (const task of tasks) {
        results.push(yield* task);
      }

      expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    });
  });

  it("rejects in-flight request on unexpected close", function* () {
    const slow = agent("slow-close", {
      work: operation<void, void>(),
    });

    yield* scoped(function* () {
      const scope = yield* useScope();
      const httpServer = createServer();
      const wss = new WebSocketServer({ server: httpServer });

      const listening = withResolvers<number>();
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        listening.resolve(addr.port);
      });
      const port = yield* listening.operation;

      // Server that closes connection immediately on any execute request
      wss.on("connection", (rawWs) => {
        rawWs.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.method === "initialize") {
            rawWs.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { protocolVersion: "1.0", sessionId: "test" },
              }),
            );
          } else if (msg.method === "execute") {
            rawWs.close();
          }
        });
      });

      const factory = websocketTransport({ url: `ws://localhost:${port}` });

      try {
        yield* installRemoteAgent(slow, factory);
        yield* invoke(slow.work());
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Transport closed");
      } finally {
        wss.clients.forEach((c) => c.close());
        wss.close();
        const closed = withResolvers<void>();
        httpServer.close(() => closed.resolve());
        yield* closed.operation;
      }
    });
  });
});
