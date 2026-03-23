import type { IncomingMessage, ServerResponse } from "node:http";
import { createQueue, withResolvers } from "effection";
import { parseHostMessage } from "@tisyn/protocol";
import type { HostMessage, AgentMessage } from "@tisyn/protocol";
import type { AgentServerTransport } from "./protocol-server.js";
import { Buffer } from "node:buffer";

export interface SsePostAgentTransport {
  transport: AgentServerTransport;
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
}

/**
 * Create an agent-side transport adapter for SSE + POST.
 *
 * The adapter owns connection state explicitly:
 * - One current SSE client connection (set by GET, cleared on close)
 * - An inbound queue fed by POST requests
 *
 * `send()` suspends until an SSE client connects, then writes events
 * to the held-open response. If the SSE client disconnects, subsequent
 * sends fail with a transport error.
 */
export function createSsePostAgentTransport(): SsePostAgentTransport {
  const inboundQueue = createQueue<HostMessage, void>();
  let sseResponse: ServerResponse | null = null;
  let disconnected = false;
  const sseReady = withResolvers<void>();

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "GET") {
      // SSE connection
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();

      sseResponse = res;
      disconnected = false;
      sseReady.resolve();

      res.on("close", () => {
        sseResponse = null;
        disconnected = true;
      });
    } else if (req.method === "POST") {
      // Enqueue inbound message
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString();
          const msg = parseHostMessage(JSON.parse(body));
          inboundQueue.add(msg);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    } else {
      res.writeHead(405);
      res.end();
    }
  }

  const transport: AgentServerTransport = {
    *receive() {
      return inboundQueue;
    },
    *send(msg: AgentMessage) {
      yield* sseReady.operation;
      if (!sseResponse || disconnected) {
        throw new Error("SSE client disconnected");
      }
      sseResponse.write(`data: ${JSON.stringify(msg)}\n\n`);
    },
  };

  return { transport, handleRequest };
}
