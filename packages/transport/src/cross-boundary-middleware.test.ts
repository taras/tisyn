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
 * CBP-5: Middleware re-propagates to grandchild on re-delegation
 * CBP-6: Propagated middleware runs outermost — before child max and child min
 * CBP-7: Propagated middleware preserves standard (effectId, data) shape in child
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import { Fn, Q, Throw, If, Eq, Ref, Eval } from "@tisyn/ir";
import {
  agent,
  operation,
  invoke,
  implementAgent,
  installCrossBoundaryMiddleware,
  Effects,
  dispatch,
} from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { createProtocolServer } from "./protocol-server.js";
import { inprocessTransport } from "./transports/inprocess.js";
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

  // CBP-5: parent middleware re-propagates to grandchild on re-delegation
  it("parent middleware re-propagates to grandchild on re-delegation", function* () {
    // Middleware that denies "cbp5.probe" but passes everything else to inner dispatch.
    // Transparent for child→grandchild routing, but blocks the sentinel in the grandchild.
    const denyProbe = Fn(
      ["effectId", "data"],
      If(
        Eq(Ref("effectId"), "cbp5.probe"),
        Throw("denied"),
        Eval("dispatch", [Ref("effectId"), Ref("data")]),
      ),
    );

    const grandchild = agent("grandchild-cbp5", {
      op: operation<{ a: number; b: number }, number>(),
    });

    // Grandchild handler probes for enforcement by dispatching the sentinel.
    // Swallows "No agent registered" (no propagated middleware path);
    // rethrows anything else (e.g. "denied" from enforcement).
    const grandchildFactory = inprocessTransport(grandchild, {
      *op({ a, b }: { a: number; b: number }) {
        try {
          yield* dispatch("cbp5.probe", null as Val);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (msg.includes("No agent registered")) {
            // expected when no middleware propagated — continue
          } else {
            throw e; // "denied" or other error — re-throw
          }
        }
        return a + b;
      },
    });

    const child = agent("child-cbp5", {
      op: operation<{ a: number; b: number }, number>(),
    });

    // Child handler installs grandchild transport in its execute scope and delegates.
    // denyProbe is transparent for "grandchild-cbp5.op" so enforcement does not block here.
    const childFactory = inprocessTransport(child, {
      *op({ a, b }: { a: number; b: number }) {
        yield* installRemoteAgent(grandchild, grandchildFactory);
        return (yield* dispatch("grandchild-cbp5.op", { a, b } as Val)) as number;
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(child, childFactory);
      yield* installCrossBoundaryMiddleware(denyProbe);

      try {
        yield* invoke(child.op({ a: 1, b: 2 }));
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("denied");
      }
    });
  });

  // CBP-6: propagated middleware runs outermost — before child max and child min
  it("propagated middleware transforms payload before child max and child min", function* () {
    // IR middleware that replaces the data payload with "transformed" and delegates
    const transform = Fn(
      ["effectId", "data"],
      Eval("dispatch", [Ref("effectId"), Q("transformed")]),
    );

    const probe = agent("probe-cbp6", {
      run: operation<void, Val>(),
    });

    // Child handler installs local max, local min, and core — all log the data they see.
    // If propagated middleware is outermost, all layers see "transformed" (not "original").
    const factory = inprocessTransport(probe, {
      *run() {
        const log: string[] = [];

        // Core handler (first min — innermost)
        yield* Effects.around(
          {
            *dispatch([_e, d]: [string, Val]) {
              log.push(`core:${d}`);
              return log as unknown as Val;
            },
          },
          { at: "min" },
        );

        // Child max middleware
        yield* Effects.around({
          *dispatch([e, d]: [string, Val], next) {
            log.push(`child-max:${d}`);
            return yield* next(e, d);
          },
        });

        // Child min middleware
        yield* Effects.around(
          {
            *dispatch([e, d]: [string, Val], next) {
              log.push(`child-min:${d}`);
              return yield* next(e, d);
            },
          },
          { at: "min" },
        );

        // Dispatch with "original" data — propagated middleware should rewrite to "transformed"
        return yield* dispatch("cbp6.sentinel", "original" as Val);
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(probe, factory);
      yield* installCrossBoundaryMiddleware(transform);

      const log = (yield* invoke(probe.run())) as unknown as string[];
      expect(log).toEqual(["child-max:transformed", "child-min:transformed", "core:transformed"]);
    });
  });

  // CBP-7: propagated middleware preserves standard (effectId, data) shape in child
  it("propagated middleware preserves standard (effectId, data) shape at child boundary", function* () {
    // IR middleware that delegates via Eval("dispatch", [effectId, data]) — standard shape
    const passthrough = Fn(["effectId", "data"], Eval("dispatch", [Ref("effectId"), Ref("data")]));

    const probe = agent("probe-cbp7", {
      run: operation<{ x: number }, Val>(),
    });

    // Child core handler records the exact effectId and data it receives.
    const factory = inprocessTransport(probe, {
      *run({ x }: { x: number }) {
        let receivedEffectId: string | null = null;
        let receivedData: Val = null as Val;

        yield* Effects.around(
          {
            *dispatch([effectId, data]: [string, Val]) {
              receivedEffectId = effectId;
              receivedData = data;
              return { receivedEffectId, receivedData } as unknown as Val;
            },
          },
          { at: "min" },
        );

        return yield* dispatch("cbp7.sentinel", { x } as unknown as Val);
      },
    });

    yield* scoped(function* () {
      yield* installRemoteAgent(probe, factory);
      yield* installCrossBoundaryMiddleware(passthrough);

      const result = (yield* invoke(probe.run({ x: 42 }))) as unknown as {
        receivedEffectId: string;
        receivedData: { x: number };
      };
      expect(result.receivedEffectId).toBe("cbp7.sentinel");
      expect(result.receivedData).toEqual({ x: 42 });
    });
  });
});
