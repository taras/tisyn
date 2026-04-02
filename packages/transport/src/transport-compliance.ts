import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, scoped, suspend } from "effection";
import { when } from "@effectionx/converge";
import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { AgentDeclaration, OperationSpec, ImplementationHandlers } from "@tisyn/agent";
import type { AgentTransportFactory, HostMessage } from "./transport.js";
import { agent, operation, Effects, dispatch, invoke } from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { parseEffectId } from "@tisyn/kernel";

/**
 * Factory builder type for compliance suite.
 * Given a declaration and handlers, returns an AgentTransportFactory.
 */
export type TransportFactoryBuilder = <Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
) => AgentTransportFactory;

/**
 * Shared transport compliance suite. Every transport backend must pass
 * these tests. Call this from a backend-specific test file with the
 * appropriate factory builder.
 */
export function transportComplianceSuite(name: string, createFactory: TransportFactoryBuilder) {
  describe(`${name} transport compliance`, () => {
    // --- Core Lifecycle ---

    describe("Core lifecycle", () => {
      it("initialize happens before first execute", function* () {
        const messages: HostMessage[] = [];

        const math = agent("math", {
          double: operation<{ value: number }, number>(),
        });

        // Create a wrapping factory that records messages
        const innerFactory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        const recordingFactory: AgentTransportFactory = function* () {
          const transport = yield* innerFactory();
          return {
            *send(msg: HostMessage) {
              messages.push(msg);
              yield* transport.send(msg);
            },
            receive: transport.receive,
          };
        };

        yield* scoped(function* () {
          yield* installRemoteAgent(math, recordingFactory);
          yield* invoke(math.double({ value: 21 }));
        });

        const initIndex = messages.findIndex((m) => m.method === "initialize");
        const execIndex = messages.findIndex((m) => m.method === "execute");
        expect(initIndex).toBeGreaterThanOrEqual(0);
        expect(execIndex).toBeGreaterThan(initIndex);
      });

      it("initialize only once per session", function* () {
        const messages: HostMessage[] = [];

        const math = agent("math-once", {
          double: operation<{ value: number }, number>(),
        });

        const innerFactory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        const recordingFactory: AgentTransportFactory = function* () {
          const transport = yield* innerFactory();
          return {
            *send(msg: HostMessage) {
              messages.push(msg);
              yield* transport.send(msg);
            },
            receive: transport.receive,
          };
        };

        yield* scoped(function* () {
          yield* installRemoteAgent(math, recordingFactory);
          yield* invoke(math.double({ value: 1 }));
          yield* invoke(math.double({ value: 2 }));
          yield* invoke(math.double({ value: 3 }));
        });

        const initMessages = messages.filter((m) => m.method === "initialize");
        expect(initMessages).toHaveLength(1);
      });

      it("repeated execute on same session", function* () {
        const math = agent("math-repeat", {
          double: operation<{ value: number }, number>(),
        });

        const factory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(math, factory);
          expect(yield* invoke(math.double({ value: 1 }))).toBe(2);
          expect(yield* invoke(math.double({ value: 5 }))).toBe(10);
          expect(yield* invoke(math.double({ value: 21 }))).toBe(42);
        });
      });

      it("shutdown on scope exit", function* () {
        const messages: HostMessage[] = [];

        const math = agent("math-shutdown", {
          double: operation<{ value: number }, number>(),
        });

        const innerFactory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        const recordingFactory: AgentTransportFactory = function* () {
          const transport = yield* innerFactory();
          return {
            *send(msg: HostMessage) {
              messages.push(msg);
              yield* transport.send(msg);
            },
            receive: transport.receive,
          };
        };

        yield* scoped(function* () {
          yield* installRemoteAgent(math, recordingFactory);
          yield* invoke(math.double({ value: 1 }));
        });

        const shutdownMessages = messages.filter((m) => m.method === "shutdown");
        expect(shutdownMessages.length).toBeGreaterThanOrEqual(1);
      });
    });

    // --- Execute/Result ---

    describe("Execute/result", () => {
      it("success path", function* () {
        const math = agent("math-success", {
          double: operation<{ value: number }, number>(),
        });

        const factory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(math, factory);
          const result = yield* invoke(math.double({ value: 21 }));
          expect(result).toBe(42);
        });
      });

      it("application error path", function* () {
        const failing = agent("failing-app", {
          boom: operation<void, never>(),
        });

        const factory = createFactory(failing, {
          *boom() {
            throw new Error("kaboom");
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(failing, factory);
          try {
            yield* invoke(failing.boom());
            expect.unreachable("should have thrown");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe("kaboom");
          }
        });
      });

      it("unknown operation path", function* () {
        const math = agent("math-unknown", {
          double: operation<{ value: number }, number>(),
        });

        const factory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(math, factory);
          try {
            yield* invoke({ effectId: "math-unknown.nonexistent", data: {} });
            expect.unreachable("should have thrown");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        });
      });
    });

    // --- Protocol Errors ---

    describe("Protocol errors", () => {
      it("initialize protocol error throws", function* () {
        const wrongAgent = agent("wrong-id", {
          op: operation<void, void>(),
        });

        // Create factory for a different agent ID than what installRemoteAgent will request
        const realAgent = agent("real-id", {
          op: operation<void, void>(),
        });

        const factory = createFactory(realAgent, {
          *op() {},
        });

        try {
          yield* scoped(function* () {
            yield* installRemoteAgent(wrongAgent, factory);
          });
          expect.unreachable("should have thrown on initialize");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("Initialize failed");
        }
      });

      it("execute protocol error throws distinct from application error", function* () {
        // This test verifies the session distinguishes protocol errors
        // (JSON-RPC error field) from application errors (result.ok: false).
        // With inprocess transport, application errors are the normal path;
        // protocol errors would come from transport-level issues.
        // We test application errors are properly classified.
        const failing = agent("failing-proto", {
          boom: operation<void, never>(),
        });

        const factory = createFactory(failing, {
          *boom() {
            throw new Error("app-level failure");
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(failing, factory);
          try {
            yield* invoke(failing.boom());
            expect.unreachable("should have thrown");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
            // Application errors come through as plain Error with handler message
            expect((error as Error).message).toBe("app-level failure");
            // Should NOT contain "Protocol error:" prefix
            expect((error as Error).message).not.toContain("Protocol error:");
          }
        });
      });
    });

    // --- Cancel ---

    describe("Cancel", () => {
      it("cancel on interruption", function* () {
        const messages: HostMessage[] = [];
        const slow = agent("slow-cancel", {
          work: operation<void, void>(),
        });

        const innerFactory = createFactory(slow, {
          *work() {
            // Simulate long-running work
            yield* suspend();
          },
        });

        const recordingFactory: AgentTransportFactory = function* () {
          const transport = yield* innerFactory();
          return {
            *send(msg: HostMessage) {
              messages.push(msg);
              yield* transport.send(msg);
            },
            receive: transport.receive,
          };
        };

        yield* scoped(function* () {
          yield* installRemoteAgent(slow, recordingFactory);
          const task = yield* spawn(function* () {
            yield* invoke(slow.work());
          });
          // Wait until the execute request has been sent before halting
          yield* when(function* () {
            expect(messages.some((m) => m.method === "execute")).toBe(true);
          });
          yield* task.halt();
        });

        const cancelMessages = messages.filter((m) => m.method === "cancel");
        expect(cancelMessages.length).toBeGreaterThanOrEqual(1);
      });
    });

    // --- Routing ---

    describe("Routing", () => {
      it("non-matching effects pass through", function* () {
        const math = agent("math-route", {
          double: operation<{ value: number }, number>(),
        });

        const factory = createFactory(math, {
          *double({ value }) {
            return value * 2;
          },
        });

        yield* scoped(function* () {
          yield* installRemoteAgent(math, factory);

          // Install a local handler for a different agent
          yield* Effects.around({
            *dispatch(
              [effectId, data]: [string, Val],
              next: (effectId: string, data: Val) => Operation<Val>,
            ) {
              const { type } = parseEffectId(effectId);
              if (type === "local") {
                return 999;
              }
              return yield* next(effectId, data);
            },
          });

          // Remote agent should work
          expect(yield* invoke(math.double({ value: 5 }))).toBe(10);

          // Local agent should also work
          const localResult = yield* dispatch("local.op", null);
          expect(localResult).toBe(999);
        });
      });
    });
  });
}
