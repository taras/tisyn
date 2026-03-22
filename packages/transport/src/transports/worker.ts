import { resource, spawn, createChannel } from "effection";
import { useWorker } from "@effectionx/worker";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory, HostMessage } from "../transport.js";

export interface WorkerTransportOptions {
  url: string | URL;
}

/**
 * Create a transport factory that spawns a worker thread and exchanges
 * protocol messages via `@effectionx/worker`.
 *
 * The worker API uses request/response semantics (every `send()` expects
 * a return value). We bridge this to the fire-and-forget `AgentTransport`
 * model by using void responses on both sides: the host sends a
 * `HostMessage` and gets `void` back; the worker sends an `AgentMessage`
 * and gets `void` back.
 */
export function workerTransport(options: WorkerTransportOptions): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const worker = yield* useWorker<HostMessage, void, void, void>(
        options.url,
        { type: "module" },
      );

      // Channel bridges worker messages to the transport's receive stream.
      // Safe from races: the session subscribes before sending initialize,
      // and the worker won't send until it receives initialize.
      const channel = createChannel<AgentMessage, void>();

      yield* spawn(function* () {
        yield* worker.forEach<AgentMessage, void>(function* (raw) {
          // JSON roundtrip: structured-cloned objects fail TypeBox
          // validation, so normalize to plain JSON objects first.
          yield* channel.send(parseAgentMessage(JSON.parse(JSON.stringify(raw))));
        });
        yield* channel.close();
      });

      yield* provide({
        *send(message: HostMessage) {
          yield* worker.send(message);
        },
        receive: channel,
      });
    });
}
