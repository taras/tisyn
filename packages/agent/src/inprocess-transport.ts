import type { Operation, Task } from "effection";
import { createChannel, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "./types.js";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "./transport.js";

/**
 * Create a transport factory for an in-process agent. The agent-side
 * processing loop runs in the same process, using channels for
 * bidirectional message passing.
 *
 * This is the reference transport. Its cancel behavior is normative:
 * cancel interrupts a running handler if still in-flight, and is
 * harmless if the handler already completed.
 */
export function inprocessTransport<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
    const hostToAgent = createChannel<HostMessage, void>();
    const agentToHost = createChannel<AgentMessage, void>();

    // In-flight handler tasks keyed by correlation ID
    const inflight = new Map<string, Task<void>>();

    // Subscribe BEFORE spawning so the subscription exists when sends arrive
    const hostSub = yield* hostToAgent;

    // Spawn agent-side processing loop
    yield* spawn(function* () {
      for (;;) {
        const { value: msg, done } = yield* hostSub.next();
        if (done) break;

        if (msg.method === "initialize") {
          const params = msg.params as {
            agentId: string;
            protocolVersion: string;
          };
          if (params.agentId !== declaration.id) {
            yield* agentToHost.send({
              jsonrpc: "2.0",
              id: msg.id as string | number,
              error: {
                code: -32002,
                message: `Unknown agent: ${params.agentId}`,
              },
            });
          } else {
            yield* agentToHost.send({
              jsonrpc: "2.0",
              id: msg.id as string | number,
              result: {
                protocolVersion: "1.0",
                sessionId: `session-${declaration.id}-${Date.now()}`,
              },
            });
          }
        } else if (msg.method === "execute") {
          const { id, params } = msg;
          const { operation: opName, args } = params;
          const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[opName];

          if (!handler) {
            yield* agentToHost.send({
              jsonrpc: "2.0",
              id,
              result: {
                ok: false,
                error: {
                  message: `No handler for operation: ${opName}`,
                  name: "MethodNotFound",
                },
              },
            });
          } else {
            // Spawn combined handler+response task so errors don't crash the agent loop
            const task = yield* spawn(function* () {
              try {
                const val = yield* handler(args[0] as Val);
                inflight.delete(id);
                yield* agentToHost.send({
                  jsonrpc: "2.0",
                  id,
                  result: { ok: true, value: val as Val },
                });
              } catch (error) {
                inflight.delete(id);
                const err = error instanceof Error ? error : new Error(String(error));
                yield* agentToHost.send({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    ok: false,
                    error: { message: err.message, name: err.name },
                  },
                });
              }
            });

            inflight.set(id, task);
          }
        } else if (msg.method === "cancel") {
          const cancelId = msg.params.id;
          const task = inflight.get(cancelId);
          if (task) {
            inflight.delete(cancelId);
            yield* task.halt();
          }
          // Unknown cancel is silently ignored
        } else if (msg.method === "shutdown") {
          yield* agentToHost.close();
          break;
        }
      }
    });

    return {
      *send(message: HostMessage) {
        yield* hostToAgent.send(message);
      },
      receive: agentToHost,
    };
  };
}
