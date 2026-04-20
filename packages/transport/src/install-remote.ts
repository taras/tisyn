import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration } from "@tisyn/agent";
import type { AgentTransportFactory } from "./transport.js";
import { parseEffectId } from "@tisyn/kernel";
import { Effects, getCrossBoundaryMiddleware } from "@tisyn/effects";
import { executeRequest } from "@tisyn/protocol";
import { createSession } from "./session.js";
import { ProgressContext, CoroutineContext } from "./progress.js";

let executionCounter = 0;

/**
 * Low-level variant of installRemoteAgent. Takes agentId string directly
 * instead of a typed AgentDeclaration. Sends empty capabilities (no method list).
 * Used by the runtime scope orchestrator where only the agent-ID string and
 * factory value are available from the IR environment.
 */
export function* installAgentTransport(
  agentId: string,
  factory: AgentTransportFactory,
): Operation<void> {
  const transport = yield* factory();
  let requestCounter = 0;
  const executionId = `exec-${agentId}-${executionCounter++}`;

  const session = yield* createSession({
    transport,
    agentId,
    capabilities: { methods: [] },
  });

  yield* Effects.around({
    *dispatch([effectId, data]: [string, Val], next) {
      const { type, name } = parseEffectId(effectId);
      if (type === agentId) {
        const requestId = `${agentId}:${requestCounter++}`;
        const middleware = yield* getCrossBoundaryMiddleware();
        const stream = session.execute(
          executeRequest(requestId, {
            executionId,
            taskId: "root",
            operation: name,
            args: [data],
            progressToken: requestId,
            ...(middleware != null ? { middleware: middleware as unknown as Val } : {}),
          }),
        );
        const sub = yield* stream;
        for (;;) {
          const item = yield* sub.next();
          if (item.done) {
            const result = item.value;
            if (result.ok) {
              return result.value as Val;
            }
            {
              const err = new Error(result.error.message);
              if (result.error.name) {
                err.name = result.error.name;
              }
              throw err;
            }
          }
          const sink = yield* ProgressContext.get();
          if (sink) {
            const cid = (yield* CoroutineContext.get()) ?? "root";
            sink({ token: requestId, effectId, coroutineId: cid, value: item.value });
          }
        }
      }
      return yield* next(effectId, data);
    },
    *resolve([id]: [string], next) {
      if (id === agentId) {
        return true;
      }
      return yield* next(id);
    },
  });
}

/**
 * Install a remote agent via a transport factory. Acquires the transport,
 * performs the initialize handshake, and installs Effects middleware that
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

  yield* Effects.around({
    *dispatch([effectId, data]: [string, Val], next) {
      const { type, name } = parseEffectId(effectId);
      if (type === id) {
        const requestId = `${id}:${requestCounter++}`;
        const middleware = yield* getCrossBoundaryMiddleware();

        const stream = session.execute(
          executeRequest(requestId, {
            executionId,
            taskId: "root",
            operation: name,
            args: [data],
            progressToken: requestId,
            ...(middleware != null ? { middleware: middleware as unknown as Val } : {}),
          }),
        );

        const sub = yield* stream;
        for (;;) {
          const item = yield* sub.next();
          if (item.done) {
            const result = item.value;
            if (result.ok) {
              return result.value as Val;
            }
            {
              const err = new Error(result.error.message);
              if (result.error.name) {
                err.name = result.error.name;
              }
              throw err;
            }
          }
          const sink = yield* ProgressContext.get();
          if (sink) {
            const cid = (yield* CoroutineContext.get()) ?? "root";
            sink({ token: requestId, effectId, coroutineId: cid, value: item.value });
          }
        }
      }
      return yield* next(effectId, data);
    },
    *resolve([agentId]: [string], next) {
      if (agentId === id) {
        return true;
      }
      return yield* next(agentId);
    },
  });
}
