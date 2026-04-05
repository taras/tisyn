import type { Operation, Subscription, Task } from "effection";
import { spawn, scoped } from "effection";
import type { AgentImplementation, OperationSpec } from "@tisyn/agent";
import {
  Effects,
  evaluateMiddlewareFn,
  installCrossBoundaryMiddleware,
} from "@tisyn/agent";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";
import { isFnNode } from "@tisyn/ir";
import {
  initializeResponse,
  initializeProtocolError,
  executeSuccess,
  executeApplicationError,
  executeProtocolError,
  ProtocolErrorCode,
} from "@tisyn/protocol";
import { assertValidIr, MalformedIR } from "@tisyn/validate";

/**
 * IO abstraction for the agent-side protocol server. Callers are responsible
 * for framing, parsing, and serialization — this server only sees typed
 * HostMessages and produces typed AgentMessages.
 */
export interface AgentServerTransport {
  receive(): Operation<Subscription<HostMessage, unknown>>;
  send(msg: AgentMessage): Operation<void>;
}

/**
 * A protocol server that handles the agent-side protocol loop on top of
 * a bound agent implementation.
 */
export interface ProtocolServer {
  use(transport: AgentServerTransport): Operation<void>;
}

/**
 * Create a protocol server from a bound agent implementation.
 *
 * The server handles initialize, execute, cancel, and shutdown messages.
 * Each execute spawns a handler task for isolation and cancellability.
 *
 * Single-arg convention: the protocol carries `args: Val[]`, but the agent
 * execution model uses a single payload object. The server extracts `args[0]`
 * as the operation payload. This matches the host-side behavior where
 * `agent.op(payload)` produces `args: [payload]`.
 */
export function createProtocolServer<Ops extends Record<string, OperationSpec>>(
  impl: AgentImplementation<Ops>,
): ProtocolServer {
  return {
    *use(transport) {
      const inflight = new Map<string, Task<void>>();
      const sub = yield* transport.receive();

      for (;;) {
        const { value: msg, done } = yield* sub.next();
        if (done) {
          break;
        }

        if (msg.method === "initialize") {
          if (msg.params.agentId !== impl.id) {
            yield* transport.send(
              initializeProtocolError(msg.id, {
                code: ProtocolErrorCode.IncompatibleVersion,
                message: `Unknown agent: ${msg.params.agentId}`,
              }),
            );
          } else {
            // Preserve current behavior: hardcoded protocol version and
            // timestamp-based session ID.
            yield* transport.send(
              initializeResponse(msg.id, {
                protocolVersion: "1.0",
                sessionId: `session-${impl.id}-${Date.now()}`,
              }),
            );
          }
        } else if (msg.method === "execute") {
          const { id, params } = msg;
          const { operation: opName, args, middleware: rawMiddleware } = params;

          // Validate middleware IR if provided
          if (rawMiddleware != null) {
            let validatedMiddleware;
            try {
              validatedMiddleware = assertValidIr(rawMiddleware);
            } catch (err) {
              if (err instanceof MalformedIR) {
                yield* transport.send(
                  executeProtocolError(id, {
                    code: ProtocolErrorCode.InvalidRequest,
                    message: `Invalid middleware IR: ${err.message}`,
                  }),
                );
                continue;
              }
              throw err;
            }

            if (!isFnNode(validatedMiddleware)) {
              yield* transport.send(
                executeProtocolError(id, {
                  code: ProtocolErrorCode.InvalidRequest,
                  message: "middleware must be a function node",
                }),
              );
              continue;
            }

            const middlewareFn = validatedMiddleware;
            const task = yield* spawn(function* () {
              yield* scoped(function* () {
                // Install cross-boundary middleware as ordinary Effects.around()
                // at default (max) priority. Installed first in this scoped block,
                // it becomes the outermost middleware — collectMiddleware's prototype
                // chain traversal ensures parent max MW always runs before child max MW.
                yield* Effects.around({
                  *dispatch([effectId, data]: [string, Val], next) {
                    return yield* evaluateMiddlewareFn(middlewareFn, effectId, data,
                      (eid: string, d: Val) => next(eid, d));
                  },
                });
                yield* installCrossBoundaryMiddleware(middlewareFn);

                try {
                  const val = yield* (
                    impl as AgentImplementation<Record<string, OperationSpec>>
                  ).call(opName, args[0] as Val);
                  inflight.delete(id);
                  yield* transport.send(executeSuccess(id, val as Val));
                } catch (error) {
                  inflight.delete(id);
                  const err = error instanceof Error ? error : new Error(String(error));
                  yield* transport.send(
                    executeApplicationError(id, { message: err.message, name: err.name }),
                  );
                }
              });
            });
            inflight.set(id, task);
          } else {
            const task = yield* spawn(function* () {
              try {
                // Single-arg convention: extract args[0] as the operation payload.
                const val = yield* (
                  impl as AgentImplementation<Record<string, OperationSpec>>
                ).call(opName, args[0] as Val);
                inflight.delete(id);
                yield* transport.send(executeSuccess(id, val as Val));
              } catch (error) {
                inflight.delete(id);
                const err = error instanceof Error ? error : new Error(String(error));
                yield* transport.send(
                  executeApplicationError(id, { message: err.message, name: err.name }),
                );
              }
            });
            inflight.set(id, task);
          }
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
    },
  };
}
