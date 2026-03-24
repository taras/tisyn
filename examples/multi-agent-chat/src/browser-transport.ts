import { once } from "@effectionx/node";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory } from "@tisyn/transport";
import {
  createChannel,
  Operation,
  resource,
  spawn,
  useScope,
  withResolvers,
  each,
} from "effection";
import { on } from "@effectionx/node";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

export function serverWebSocketTransport(
  rawWs: WebSocket
): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const scope = yield* useScope();
      const channel = createChannel<AgentMessage, void>();

      yield* spawn(function* () {
        for (const message of yield* each(on(rawWs, "message"))) {
          channel.send(parseAgentMessage(JSON.parse(message.toString())));
          yield* each.next();
        }
      });

      yield* spawn(function* () {
        yield* on(rawWs, 'on');
        channel.close();
      })

      try {
        yield* provide({
          *send(msg: HostMessage) {
            rawWs.send(JSON.stringify(msg));
          },
          receive: channel,
        });
      } finally {
        yield* channel.close();
      }
    });
}

export function useWebSocketServer(): Operation<WebSocket> {
  return resource(function* (provide) {
    // 1. Start WebSocket server
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    const listening = withResolvers<void>();
    httpServer.listen(3000, listening.resolve);

    const addr = httpServer.address() as AddressInfo;
    console.log(`WebSocket server listening on ws://localhost:${addr.port}`);

    console.log("Waiting for browser connection...");
    const [browserWs] = yield* once<[WebSocket]>(wss, "connection");

    try {
      yield* provide(browserWs);
    } finally {
      httpServer.close();
      wss.close();
    }
  });
}
