import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration } from "@tisyn/agent";
import type { AgentTransportFactory } from "./transport.js";
import { parseEffectId } from "@tisyn/kernel";
import { Dispatch } from "@tisyn/agent";
import { createSession } from "./session.js";

let executionCounter = 0;

/**
 * Install a remote agent via a transport factory. Acquires the transport,
 * performs the initialize handshake, and installs Dispatch middleware that
 * routes matching effects through the protocol session.
 *
 * Transport connect, initialize, and shutdown are all owned by this scope.
 */
export function* installRemoteAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  factory: AgentTransportFactory,
): Operation<void> {
  const transport = yield* factory();
  const { id } = declaration;
  const executionId = `exec-${id}-${executionCounter++}`;
  let requestCounter = 0;

  const methods = Object.keys(declaration.operations);

  const session = yield* createSession({
    transport,
    agentId: id,
    capabilities: {
      methods,
    },
  });

  yield* Dispatch.around({
    *dispatch([effectId, data]: [string, Val], next) {
      const { type, name } = parseEffectId(effectId);
      if (type === id) {
        const requestId = `${id}:${requestCounter++}`;

        const stream = session.execute({
          jsonrpc: "2.0",
          id: requestId,
          method: "execute",
          params: {
            executionId,
            taskId: "root",
            operation: name,
            args: [data],
          },
        });

        // Subscribe and drain — Phase 1 discards progress
        const sub = yield* stream;
        for (;;) {
          const item = yield* sub.next();
          if (item.done) {
            const result = item.value;
            if (result.ok) {
              return result.value as Val;
            }
            throw new Error(result.error.message);
          }
          // Progress value — discard in Phase 1
        }
      }
      return yield* next(effectId, data);
    },
  });
}
