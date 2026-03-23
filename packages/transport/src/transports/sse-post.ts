import { resource, spawn, createQueue, each } from "effection";
import { fetch } from "@effectionx/fetch";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory, HostMessage } from "../transport.js";

export interface SsePostTransportOptions {
  /** Base URL of the agent's HTTP server, e.g. "http://localhost:3000" */
  url: string;
  /** SSE endpoint path. Defaults to "/events" */
  ssePath?: string;
  /** POST endpoint path. Defaults to "/messages" */
  postPath?: string;
}

/**
 * Create a transport factory that connects to an SSE + POST endpoint.
 *
 * The host opens a long-lived SSE connection (GET) to receive all
 * agent messages, and sends host messages via HTTP POST.
 *
 * Cancellation is fully cooperative: the SSE body stream is consumed
 * via `each()` which is natively cancellable by effection.
 */
export function ssePostTransport(options: SsePostTransportOptions): AgentTransportFactory {
  const { url, ssePath = "/events", postPath = "/messages" } = options;

  return () =>
    resource(function* (provide) {
      const queue = createQueue<AgentMessage, void>();

      // Open SSE connection.
      const response = yield* fetch(`${url}${ssePath}`, {
        headers: { Accept: "text/event-stream" },
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      // Spawn reader loop: consume the response body as an effection
      // stream (natively cancellable), parse SSE events manually, and
      // push parsed protocol messages into the queue.
      yield* spawn(function* () {
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (const chunk of yield* each(response.body())) {
            buffer += decoder.decode(chunk, { stream: true });

            // Extract complete SSE events (double newline separated)
            let boundary: number;
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              // Extract data: lines and join them
              const data = block
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");

              if (data) {
                queue.add(parseAgentMessage(JSON.parse(data)));
              }
            }

            yield* each.next();
          }
        } catch {
          // Abort/network errors are expected on teardown
        } finally {
          queue.close();
        }
      });

      // Wrap the queue as a Stream (Operation<Subscription>).
      const receive = { *[Symbol.iterator]() { return queue; } };

      yield* provide({
        *send(message: HostMessage) {
          yield* fetch(`${url}${postPath}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
          }).expect();
        },
        receive,
      });
    });
}
