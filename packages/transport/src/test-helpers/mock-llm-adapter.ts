import type { Operation, Task } from "effection";
import { createChannel, createScope, ensure, spawn, sleep, suspend } from "effection";
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

export interface MockAdapterConfig {
  result?: Val;
  error?: { message: string; name?: string };
  progress?: Val[];
  /** Progress items sent AFTER the terminal result (to test late-progress discard). */
  lateProgress?: Val[];
  /** Delay in ms before sending the result, to keep the request in-flight. */
  delay?: number;
  neverComplete?: boolean;
}

export function createMockLlmTransport(config: MockAdapterConfig): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
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
        if (done) {
          break;
        }

        if (msg.method === "initialize") {
          yield* agentToHost.send(
            initializeResponse(msg.id, {
              protocolVersion: "1.0",
              sessionId: `mock-session-${Date.now()}`,
            }),
          );
        } else if (msg.method === "execute") {
          const { id } = msg;
          const token = msg.params.progressToken ?? id;

          const task = yield* spawn(function* () {
            // Emit configured progress items
            for (const p of config.progress ?? []) {
              yield* agentToHost.send(progressNotification(token, p));
            }

            if (config.neverComplete) {
              yield* suspend();
            }

            if (config.delay) {
              yield* sleep(config.delay);
            }

            // Send result or error
            if (config.error) {
              yield* agentToHost.send(executeApplicationError(id, config.error));
            } else {
              yield* agentToHost.send(executeSuccess(id, config.result ?? null));
            }

            // Send late progress after the terminal result (for LS-013 testing)
            for (const p of config.lateProgress ?? []) {
              yield* agentToHost.send(progressNotification(token, p));
            }

            inflight.delete(id);
          });
          inflight.set(id, task);
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
}
