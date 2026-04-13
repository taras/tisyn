/**
 * Mock CodeAgent transport for testing.
 *
 * Simulates a conforming CodeAgent adapter at the Tisyn protocol level.
 * The transport factory returns a resource-scoped transport — the
 * message processing loop is a spawned child, so its lifetime is
 * owned by the enclosing resource scope.
 *
 * Supports all five contract operations: newSession, closeSession,
 * prompt, fork, openFork. Each operation can be configured
 * independently with result, error, progress, delay.
 */

import type { Task } from "effection";
import { createChannel, resource, spawn, sleep, suspend } from "effection";
import type { Val } from "@tisyn/ir";
import type { AgentTransportFactory, HostMessage, AgentMessage } from "@tisyn/transport";
import {
  initializeResponse,
  executeSuccess,
  executeApplicationError,
  progressNotification,
} from "@tisyn/protocol";

export interface MockOperationConfig {
  result?: Val;
  error?: { message: string; name?: string };
  progress?: Val[];
  delay?: number;
  neverComplete?: boolean;
}

export interface MockCodeAgentConfig {
  newSession?: MockOperationConfig;
  closeSession?: MockOperationConfig;
  prompt?: MockOperationConfig;
  fork?: MockOperationConfig;
  openFork?: MockOperationConfig;
}

/**
 * Create a mock AgentTransportFactory that simulates CodeAgent behavior.
 *
 * Routes execute requests by operation name to per-operation configs.
 * Supports progress, delay, error injection, and neverComplete (for cancel tests).
 *
 * Returns a `calls` array that records every execute request received,
 * so tests can assert on what was dispatched.
 */
export function createMockCodeAgentTransport(config: MockCodeAgentConfig): {
  factory: AgentTransportFactory;
  calls: Array<{ operation: string; args: Val }>;
} {
  const calls: Array<{ operation: string; args: Val }> = [];

  const factory: AgentTransportFactory = () =>
    resource(function* (provide) {
      const hostToAgent = createChannel<HostMessage, void>();
      const agentToHost = createChannel<AgentMessage, void>();

      const hostSub = yield* hostToAgent;

      yield* spawn(function* () {
        const inflight = new Map<string, Task<void>>();

        for (;;) {
          const { value: msg, done } = yield* hostSub.next();
          if (done) {
            break;
          }

          if (msg.method === "initialize") {
            yield* agentToHost.send(
              initializeResponse(msg.id, {
                protocolVersion: "1.0",
                sessionId: `mock-ca-session-${Date.now()}`,
              }),
            );
          } else if (msg.method === "execute") {
            const { id, params } = msg;
            const token = params.progressToken ?? id;
            const opName = params.operation.includes(".")
              ? params.operation.split(".").pop()!
              : params.operation;

            calls.push({ operation: opName, args: params.args[0] as Val });

            const opConfig =
              (config as Record<string, MockOperationConfig | undefined>)[opName] ?? {};

            const task = yield* spawn(function* () {
              for (const p of opConfig.progress ?? []) {
                yield* agentToHost.send(progressNotification(String(token), p));
              }

              if (opConfig.neverComplete) {
                yield* suspend();
              }

              if (opConfig.delay) {
                yield* sleep(opConfig.delay);
              }

              if (opConfig.error) {
                yield* agentToHost.send(executeApplicationError(String(id), opConfig.error));
              } else {
                yield* agentToHost.send(executeSuccess(String(id), opConfig.result ?? null));
              }

              inflight.delete(String(id));
            });
            inflight.set(String(id), task);
          } else if (msg.method === "cancel") {
            const task = inflight.get(msg.params.id);
            if (task) {
              inflight.delete(msg.params.id);
              yield* task.halt();
            }
          } else if (msg.method === "shutdown") {
            break;
          }
        }
        yield* agentToHost.close();
      });

      yield* provide({
        *send(message: HostMessage) {
          yield* hostToAgent.send(message);
        },
        receive: agentToHost,
      });
    });

  return { factory, calls };
}
