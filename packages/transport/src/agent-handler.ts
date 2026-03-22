import type { Operation, Subscription, Task } from "effection";
import { spawn } from "effection";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import {
  initializeResponse,
  initializeProtocolError,
  executeSuccess,
  executeApplicationError,
  ProtocolErrorCode,
} from "@tisyn/protocol";

/**
 * IO abstraction for the agent-side protocol handler. Callers are responsible
 * for framing, parsing, and serialization — this handler only sees typed
 * HostMessages and produces typed AgentMessages.
 */
export interface AgentHandlerIO {
  receive: Subscription<HostMessage, unknown>;
  send(msg: AgentMessage): Operation<void>;
}

/**
 * Shared agent-side protocol loop. Handles initialize, execute, cancel,
 * and shutdown messages. Each execute spawns a handler task for isolation
 * and cancellability.
 *
 * This function owns only protocol dispatch and handler lifecycle. It does
 * not own framing, parsing, or serialization — those are the caller's
 * responsibility via the AgentHandlerIO abstraction.
 */
export function* runAgentHandler<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
  io: AgentHandlerIO,
): Operation<void> {
  const inflight = new Map<string, Task<void>>();

  for (;;) {
    const { value: msg, done } = yield* io.receive.next();
    if (done) break;

    if (msg.method === "initialize") {
      if (msg.params.agentId !== declaration.id) {
        yield* io.send(
          initializeProtocolError(msg.id, {
            code: ProtocolErrorCode.IncompatibleVersion,
            message: `Unknown agent: ${msg.params.agentId}`,
          }),
        );
      } else {
        yield* io.send(
          initializeResponse(msg.id, {
            protocolVersion: "1.0",
            sessionId: `session-${declaration.id}-${Date.now()}`,
          }),
        );
      }
    } else if (msg.method === "execute") {
      const { id, params } = msg;
      const { operation: opName, args } = params;
      const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[opName];

      if (!handler) {
        yield* io.send(
          executeApplicationError(id, {
            message: `No handler for operation: ${opName}`,
            name: "MethodNotFound",
          }),
        );
      } else {
        const task = yield* spawn(function* () {
          try {
            const val = yield* handler(args[0] as Val);
            inflight.delete(id);
            yield* io.send(executeSuccess(id, val as Val));
          } catch (error) {
            inflight.delete(id);
            const err = error instanceof Error ? error : new Error(String(error));
            yield* io.send(executeApplicationError(id, { message: err.message, name: err.name }));
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
    } else if (msg.method === "shutdown") {
      break;
    }
  }
}
