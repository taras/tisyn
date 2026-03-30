/**
 * Cross-boundary middleware tests.
 *
 * Verifies that installCrossBoundaryMiddleware() propagates parent middleware
 * over the protocol to the child, where it is installed as enforcement.
 *
 * CBP-1: Parent middleware (deny) blocks child operation
 * CBP-2: No middleware in scope → remote operation succeeds normally
 * CBP-3: Parent middleware short-circuits → child returns value without executing handler
 * CBP-4: Malformed middleware IR via direct protocol message → InvalidRequest error
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, createChannel, spawn } from "effection";
import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import { Fn, Q, Throw } from "@tisyn/ir";
import type { OperationSpec } from "@tisyn/agent";
import {
  agent,
  operation,
  invoke,
  implementAgent,
  installCrossBoundaryMiddleware,
  dispatch,
} from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { createProtocolServer } from "./protocol-server.js";
import { inprocessTransport } from "./transports/inprocess.js";
import type { AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import type {
  HostMessage as ProtoHostMessage,
  AgentMessage as ProtoAgentMessage,
} from "@tisyn/protocol";
import { executeRequest, ProtocolErrorCode } from "@tisyn/protocol";

// IR middleware that unconditionally denies any dispatch (throws "denied")
// Uses Throw as a structural op — kernel throws ExplicitThrow("denied") directly,
// no yield, so evaluateMiddlewareFn propagates it as a real exception.
const alwaysDeny = Fn(["effectId", "data"], Throw("denied"));

// IR middleware that always short-circuits with a fixed value (never calls dispatch)
const shortCircuit = Fn(["effectId", "data"], Q("short-circuit"));

describe("cross-boundary middleware", () => {
  // CBP-1: parent middleware blocks child operation
  it("parent middleware (deny) blocks the remote child operation", function* () {
    const calc = agent("calc-cbp1", {
      add: operation<{ a: number; b: number }, number>(),
    });

    // Handler calls dispatch internally so enforcement fires when middleware is installed.
    // alwaysDeny middleware throws "denied" before dispatch reaches any real handler.
    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        return yield* dispatch("calc-cbp1.add", { a, b } as Val);
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(calc, factory);
      yield* installCrossBoundaryMiddleware(alwaysDeny);

      try {
        yield* invoke(calc.add({ a: 1, b: 2 }));
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("denied");
      }
    });
  });

  // CBP-2: no middleware → remote operation succeeds normally
  it("no cross-boundary middleware in scope → remote operation succeeds", function* () {
    const calc = agent("calc-cbp2", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        return a + b;
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(calc, factory);
      // No installCrossBoundaryMiddleware call
      const result = yield* invoke(calc.add({ a: 3, b: 4 }));
      expect(result).toBe(7);
    });
  });

  // CBP-3: parent middleware short-circuits → dispatch returns middleware value
  it("parent middleware short-circuit returns value without executing child handler", function* () {
    const calc = agent("calc-cbp3", {
      add: operation<{ a: number; b: number }, string>(),
    });

    // Handler calls dispatch internally so enforcement fires when middleware is installed.
    // shortCircuit middleware returns "short-circuit" before dispatch reaches any real handler.
    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        return yield* dispatch("calc-cbp3.add", { a, b } as Val) as string;
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(calc, factory);
      yield* installCrossBoundaryMiddleware(shortCircuit);

      const result = yield* invoke(calc.add({ a: 1, b: 2 }));
      expect(result).toBe("short-circuit");
    });
  });

  // CBP-4: malformed middleware IR via direct protocol → InvalidRequest
  it("malformed middleware IR in execute request causes InvalidRequest protocol error", function* () {
    const calc = agent("calc-cbp4", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const impl = implementAgent(calc, {
      *add({ a, b }: { a: number; b: number }) {
        return a + b;
      },
    });

    const server = createProtocolServer(impl);

    const outgoing: ProtoAgentMessage[] = [];

    // Feed a fixed sequence of messages through a fake transport
    const messages: ProtoHostMessage[] = [
      {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          agentId: "calc-cbp4",
          protocolVersion: "1.0",
          capabilities: { methods: ["add"] },
        },
      } as ProtoHostMessage,
      executeRequest("req-1", {
        executionId: "exec-1",
        taskId: "root",
        operation: "add",
        args: [{ a: 1, b: 2 } as Val],
        // Q(null) is a QuoteNode, not a FnNode — should trigger InvalidRequest
        middleware: Q(null) as Val,
      }),
      { jsonrpc: "2.0", method: "shutdown", params: {} } as ProtoHostMessage,
    ];

    let msgIdx = 0;

    yield* server.use({
      *receive(): Operation<{ next(): Operation<IteratorResult<ProtoHostMessage, unknown>> }> {
        return {
          *next() {
            if (msgIdx < messages.length) {
              return { value: messages[msgIdx++]!, done: false };
            }
            return { value: undefined as unknown, done: true };
          },
        };
      },
      *send(msg: ProtoAgentMessage): Operation<void> {
        outgoing.push(msg);
      },
    });

    const execResponse = outgoing.find((m) => "id" in m && m.id === "req-1");
    expect(execResponse).toBeDefined();
    const errResp = execResponse as { error?: { code: number; message: string } };
    expect(errResp.error).toBeDefined();
    expect(errResp.error!.code).toBe(ProtocolErrorCode.InvalidRequest);
  });
});
