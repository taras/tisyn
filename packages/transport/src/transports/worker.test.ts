import { MessageChannel } from "node:worker_threads";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { resource, useScope, createQueue, createChannel, spawn } from "effection";
import type { HostMessage } from "@tisyn/protocol";
import { parseHostMessage, parseAgentMessage } from "@tisyn/protocol";
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent } from "../install-remote.js";
import { runAgentHandler } from "../agent-handler.js";
import { transportComplianceSuite } from "../transport-compliance.js";
import type { TransportFactoryBuilder } from "../transport-compliance.js";
import { workerTransport } from "./worker.js";

// ---------------------------------------------------------------------------
// Part A: Compliance suite (MessagePort serialization harness)
//
// This builder uses `MessageChannel` from `node:worker_threads` to create a
// same-process serialization boundary. It validates protocol correctness over
// structured-clone serialization but does NOT exercise the `@effectionx/worker`
// host/worker lifecycle. Real worker lifecycle is tested in Part B.
// ---------------------------------------------------------------------------

const workerBuilder: TransportFactoryBuilder = (declaration, handlers) => {
  return () =>
    resource(function* (provide) {
      const scope = yield* useScope();
      const { port1, port2 } = new MessageChannel();

      // Agent side: buffer messages from port into a queue for runAgentHandler
      // (which expects a Subscription, not a Stream).
      // JSON roundtrip ensures TypeBox sees plain objects identical to
      // what a real transport (websocket/stdio) produces after JSON.parse.
      const agentQueue = createQueue<HostMessage, void>();
      port2.on("message", (data: string) => {
        agentQueue.add(parseHostMessage(JSON.parse(data)));
      });
      port2.on("close", () => agentQueue.close());

      scope.run(function* () {
        yield* runAgentHandler(declaration, handlers, {
          receive: agentQueue,
          *send(msg) {
            port2.postMessage(JSON.stringify(msg));
          },
        });
      });

      // Host side: bridge port messages into a channel (which is a Stream,
      // as required by AgentTransport.receive)
      const hostChannel = createChannel<ReturnType<typeof parseAgentMessage>, void>();
      port1.on("message", (data: string) => {
        scope.run(function* () {
          yield* hostChannel.send(parseAgentMessage(JSON.parse(data)));
        });
      });

      try {
        yield* provide({
          *send(message: HostMessage) {
            port1.postMessage(JSON.stringify(message));
          },
          receive: hostChannel,
        });
      } finally {
        port1.close();
        port2.close();
      }
    });
};

transportComplianceSuite("worker", workerBuilder);

// ---------------------------------------------------------------------------
// Part B: Real worker integration tests
//
// These test the actual `workerTransport()` + `runWorkerAgent()` stack through
// a real worker thread via `@effectionx/worker`.
// ---------------------------------------------------------------------------

describe("worker transport (real worker)", () => {
  it("success round-trip through a real worker thread", function* () {
    const math = agent("math-worker", {
      double: operation<{ value: number }, number>(),
    });

    const factory = workerTransport({
      url: import.meta.resolve("./test-assets/math-worker.ts"),
    });

    yield* installRemoteAgent(math, factory);

    const result = yield* invoke(math.double({ value: 21 }));
    expect(result).toBe(42);
  });

  it("handles concurrent requests through a real worker", function* () {
    const math = agent("math-worker", {
      double: operation<{ value: number }, number>(),
    });

    const factory = workerTransport({
      url: import.meta.resolve("./test-assets/math-worker.ts"),
    });

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

  it("propagates application errors from a real worker", function* () {
    const failing = agent("failing-worker", {
      boom: operation<void, never>(),
    });

    const factory = workerTransport({
      url: import.meta.resolve("./test-assets/failing-worker.ts"),
    });

    yield* installRemoteAgent(failing, factory);

    try {
      yield* invoke(failing.boom());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("worker-kaboom");
    }
  });
});
