/**
 * Mock Claude Code adapter for testing.
 *
 * Simulates the Claude Code ACP agent at the Tisyn protocol level,
 * following the same channel-based pattern as mock-llm-adapter.ts.
 *
 * Supports all five operations: openSession, closeSession, plan, fork, openFork.
 * Each operation can be configured independently with result, error, progress, delay.
 */

import type { Operation, Task } from "effection";
import { createChannel, createScope, ensure, spawn, sleep } from "effection";
import type { Val } from "@tisyn/ir";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "../transport.js";
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

  const factory: AgentTransportFactory = function* (): Operation<AgentTransport> {
    const hostToAgent = createChannel<HostMessage, void>();
    const agentToHost = createChannel<AgentMessage, void>();

    // Subscribe BEFORE spawning so the subscription exists when sends arrive
    const hostSub = yield* hostToAgent;

    const [agentScope, destroyScope] = createScope();
    yield* ensure(destroyScope);

    agentScope.run(function* () {
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
          const operation = params.operation;

          // Extract the operation suffix (e.g., "claude-code.plan" → "plan")
          const opName = operation.includes(".")
            ? operation.split(".").pop()!
            : operation;

          calls.push({ operation: opName, args: params.args[0] as Val });

          // Look up per-operation config, fall back to empty
          const opConfig = (config as Record<string, MockOperationConfig | undefined>)[opName] ?? {};

          const task = yield* spawn(function* () {
            // Emit configured progress items
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

    return {
      *send(message: HostMessage) {
        yield* hostToAgent.send(message);
      },
      receive: agentToHost,
    };
  };

  return { factory, calls };
}
