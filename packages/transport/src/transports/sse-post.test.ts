import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { resource, useScope, withResolvers, scoped, spawn } from "effection";
import { agent, operation, invoke, implementAgent } from "@tisyn/agent";
import { installRemoteAgent } from "../install-remote.js";
import { createProtocolServer } from "../protocol-server.js";
import { transportComplianceSuite } from "../transport-compliance.js";
import type { TransportFactoryBuilder } from "../transport-compliance.js";
import { createSsePostAgentTransport } from "../sse-post-agent.js";
import { ssePostTransport } from "./sse-post.js";

// ---------------------------------------------------------------------------
// Part A: Compliance suite
// ---------------------------------------------------------------------------

const ssePostBuilder: TransportFactoryBuilder = (declaration, handlers) => {
  return () =>
    resource(function* (provide) {
      const scope = yield* useScope();
      const agentAdapter = createSsePostAgentTransport();

      // Track open connections so we can destroy them on teardown,
      // allowing httpServer.close() to complete promptly.
      const connections = new Set<import("node:net").Socket>();
      const httpServer = createServer((req, res) => {
        agentAdapter.handleRequest(req, res);
      });
      httpServer.on("connection", (socket) => {
        connections.add(socket);
        socket.on("close", () => connections.delete(socket));
      });

      const listening = withResolvers<number>();
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        listening.resolve(addr.port);
      });
      const port = yield* listening.operation;

      const impl = implementAgent(declaration, handlers);
      const server = createProtocolServer(impl);

      scope.run(function* () {
        yield* server.use(agentAdapter.transport);
      });

      const innerFactory = ssePostTransport({
        url: `http://localhost:${port}`,
      });
      const transport = yield* innerFactory();

      try {
        yield* provide(transport);
      } finally {
        // Destroy all open connections (SSE + any keep-alive POST connections)
        // so httpServer.close() can drain immediately.
        for (const socket of connections) {
          socket.destroy();
        }
        const closed = withResolvers<void>();
        httpServer.close(() => closed.resolve());
        yield* closed.operation;
      }
    });
};

transportComplianceSuite("sse-post", ssePostBuilder);

// ---------------------------------------------------------------------------
// Part B: SSE+POST-specific tests
// ---------------------------------------------------------------------------

describe("sse-post transport specific", () => {
  it("handles concurrent requests", function* () {
    const math = agent("math-sse-concurrent", {
      double: operation<{ value: number }, number>(),
    });

    const factory = ssePostBuilder(math, {
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

  it("rejects in-flight request on SSE disconnect", function* () {
    const slow = agent("slow-sse-close", {
      work: operation<void, void>(),
    });

    yield* scoped(function* () {
      const httpServer = createServer();

      const listening = withResolvers<number>();
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        listening.resolve(addr.port);
      });
      const port = yield* listening.operation;

      let sseRes: import("node:http").ServerResponse | null = null;

      httpServer.on("request", (req, res) => {
        if (req.method === "GET") {
          // SSE endpoint — send initialize response then close
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.flushHeaders();
          sseRes = res;

          // We'll handle messages manually below
        } else if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            const msg = JSON.parse(Buffer.concat(chunks).toString());
            if (msg.method === "initialize") {
              // Send initialize response over SSE
              const response = {
                jsonrpc: "2.0",
                id: msg.id,
                result: { protocolVersion: "1.0", sessionId: "test" },
              };
              sseRes!.write(`data: ${JSON.stringify(response)}\n\n`);
            } else if (msg.method === "execute") {
              // Close SSE instead of responding
              sseRes!.end();
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
        }
      });

      const factory = ssePostTransport({ url: `http://localhost:${port}` });

      try {
        yield* installRemoteAgent(slow, factory);
        yield* invoke(slow.work());
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Transport closed");
      } finally {
        const closed = withResolvers<void>();
        httpServer.close(() => closed.resolve());
        yield* closed.operation;
      }
    });
  });
});
