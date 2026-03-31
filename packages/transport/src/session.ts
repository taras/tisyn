import type { Operation, Stream } from "effection";
import { resource, spawn, createSignal, withResolvers } from "effection";
import type { AgentCapabilities, ExecuteRequest, ResultPayload } from "@tisyn/protocol";
import { initializeRequest, cancelNotification, shutdownNotification } from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";
import type { AgentTransport } from "./transport.js";

/**
 * A protocol session over a transport. Handles initialize handshake,
 * request/response correlation, progress routing, cancel-on-interrupt,
 * and shutdown.
 */
export interface ProtocolSession {
  execute(request: ExecuteRequest): Stream<Val, ResultPayload>;
}

export interface CreateSessionOptions {
  transport: AgentTransport;
  agentId: string;
  capabilities: AgentCapabilities;
}

interface PendingRequest {
  onResult(result: ResultPayload): void;
  onProtocolError(error: Error): void;
  onProgress(value: Val): void;
}

/**
 * Create a protocol session over a transport. Performs the initialize
 * handshake and spawns a receiver loop for correlating responses.
 *
 * Uses `resource()` so the receiver loop stays alive at the parent's
 * priority level, avoiding priority inversion deadlocks.
 */
export function createSession(options: CreateSessionOptions): Operation<ProtocolSession> {
  return resource(function* (provide) {
    const { transport, agentId, capabilities } = options;
    const pending = new Map<string, PendingRequest>();

    // Subscribe to receive stream
    const sub = yield* transport.receive;

    const { resolve: resolveInit, reject: rejectInit, operation: initOp } = withResolvers<void>();

    // --- Receiver loop (handles init response + all subsequent messages) ---
    yield* spawn(function* () {
      // First message must be the initialize response
      const initResult = yield* sub.next();
      if (initResult.done) {
        rejectInit(new Error("Transport closed before initialize response"));
        return;
      }

      const initMsg = initResult.value;
      if ("error" in initMsg) {
        rejectInit(
          new Error(`Initialize failed: ${initMsg.error.message} (code ${initMsg.error.code})`),
        );
        return;
      }
      if (!("result" in initMsg && "sessionId" in initMsg.result)) {
        rejectInit(new Error("Unexpected message during initialize"));
        return;
      }
      resolveInit(undefined);

      // Continue as execute-response receiver loop
      try {
        for (;;) {
          const { value, done } = yield* sub.next();
          if (done) break;

          if ("result" in value && "ok" in value.result) {
            const req = pending.get(String(value.id));
            if (req) {
              pending.delete(String(value.id));
              req.onResult(value.result as ResultPayload);
            }
          } else if ("error" in value && "id" in value) {
            const id = String(value.id);
            const req = pending.get(id);
            if (req) {
              pending.delete(id);
              req.onProtocolError(
                new Error(`Protocol error: ${value.error.message} (code ${value.error.code})`),
              );
            }
          } else if ("method" in value && value.method === "progress") {
            const req = pending.get(value.params.token);
            if (req) {
              req.onProgress(value.params.value);
            }
          }
        }
      } catch (error) {
        // Transport stream error (e.g. malformed data) — reject all pending requests
        const transportError = error instanceof Error ? error : new Error(String(error));
        for (const [id, req] of pending) {
          pending.delete(id);
          req.onProtocolError(transportError);
        }
        return;
      }

      // Transport stream ended — reject all pending requests
      for (const [id, req] of pending) {
        pending.delete(id);
        req.onProtocolError(new Error("Transport closed with in-flight request"));
      }
    });

    // Send initialize and wait for response
    yield* transport.send(initializeRequest(1, { protocolVersion: "1.0", agentId, capabilities }));

    yield* initOp;

    const session: ProtocolSession = {
      execute(request: ExecuteRequest): Stream<Val, ResultPayload> {
        return resource(function* (provide) {
          const signal = createSignal<Val, void>();
          let terminal:
            | { ok: true; result: ResultPayload }
            | { ok: false; error: Error }
            | undefined;

          const signalSub = yield* signal;

          pending.set(request.id, {
            onResult(result: ResultPayload) {
              terminal = { ok: true, result };
              signal.close();
            },
            onProtocolError(error: Error) {
              terminal = { ok: false, error };
              signal.close();
            },
            onProgress(value: Val) {
              signal.send(value);
            },
          });

          yield* transport.send(request);

          try {
            yield* provide({
              *next(): Operation<IteratorResult<Val, ResultPayload>> {
                const item = yield* signalSub.next();
                if (item.done) {
                  if (!terminal) {
                    throw new Error("Execute stream closed without result");
                  }
                  if (!terminal.ok) {
                    throw terminal.error;
                  }
                  return { done: true, value: terminal.result };
                }
                return item;
              },
            });
          } finally {
            if (pending.has(request.id)) {
              pending.delete(request.id);
              try {
                yield* transport.send(cancelNotification(request.id));
              } catch {
                // Transport may already be closed
              }
            }
          }
        });
      },
    };

    try {
      yield* provide(session);
    } finally {
      try {
        yield* transport.send(shutdownNotification());
      } catch {
        // Transport may already be closed (e.g. child process exited)
      }
    }
  });
}
