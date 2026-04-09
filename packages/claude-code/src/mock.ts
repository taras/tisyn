/**
 * Mock Claude Code adapter for testing.
 *
 * Simulates the Claude Code ACP agent at the Tisyn protocol level.
 * The transport factory returns a resource-scoped transport — the
 * message processing loop is a spawned child, so its lifetime is
 * owned by the enclosing resource scope (no manual createScope).
 *
 * Supports all five operations: openSession, closeSession, plan, fork, openFork.
 * Each operation can be configured independently with result, error, progress, delay.
 */

import type { Operation, Task } from "effection";
import { createChannel, resource, spawn, sleep } from "effection";
import type { Val } from "@tisyn/ir";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "@tisyn/transport";
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

export interface MockClaudeCodeConfig {
  openSession?: MockOperationConfig;
  closeSession?: MockOperationConfig;
  plan?: MockOperationConfig;
  fork?: MockOperationConfig;
  openFork?: MockOperationConfig;
}

/**
 * Create a mock AgentTransportFactory that simulates Claude Code ACP behavior.
 *
 * Routes execute requests by operation name to per-operation configs.
 * Supports progress, delay, error injection, and neverComplete (for cancel tests).
 *
 * Returns a `calls` array that records every execute request received,
 * so tests can assert on what was dispatched.
 */
export function createMockClaudeCodeTransport(config: MockClaudeCodeConfig): {
  factory: AgentTransportFactory;
  calls: Array<{ operation: string; args: Val }>;
} {
  const calls: Array<{ operation: string; args: Val }> = [];

  const factory: AgentTransportFactory = () =>
    resource(function* (provide) {
      const hostToAgent = createChannel<HostMessage, void>();
      const agentToHost = createChannel<AgentMessage, void>();

      // Subscribe BEFORE spawning so the subscription exists when sends arrive
      const hostSub = yield* hostToAgent;

      // Message processing loop — spawned as a child of this resource scope.
      // Its lifetime is owned by the resource: when the resource scope exits,
      // this task is automatically halted.
      yield* spawn(function* () {
        const inflight = new Map<string, Task<void>>();

        for (;;) {
          const { value: msg, done } = yield* hostSub.next();
          if (done) break;

          if (msg.method === "initialize") {
            yield* agentToHost.send(
              initializeResponse(msg.id, {
                protocolVersion: "1.0",
                sessionId: `mock-cc-session-${Date.now()}`,
              }),
            );
          } else if (msg.method === "execute") {
            const { id, params } = msg;
            const token = params.progressToken ?? id;
            const opName = params.operation.includes(".")
              ? params.operation.split(".").pop()!
              : params.operation;

            calls.push({ operation: opName, args: params.args[0] as Val });

            const opConfig = (config as Record<string, MockOperationConfig | undefined>)[opName] ?? {};

            const task = yield* spawn(function* () {
              for (const p of opConfig.progress ?? []) {
                yield* agentToHost.send(progressNotification(String(token), p));
              }

              if (opConfig.neverComplete) {
                yield* sleep(2_147_483_647);
                return;
              }

              if (opConfig.delay) {
                yield* sleep(opConfig.delay);
              }

              if (opConfig.error) {
                yield* agentToHost.send(executeApplicationError(String(id), opConfig.error));
              } else {
                yield* agentToHost.send(
                  executeSuccess(String(id), opConfig.result ?? null),
                );
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
