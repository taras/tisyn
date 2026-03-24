import { once } from "@effectionx/node";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory } from "@tisyn/transport";
import {
  createChannel,
  Operation,
  resource,
  spawn,
  withResolvers,
  each,
} from "effection";
import { on } from "@effectionx/node";
import { createServer, IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Server, WebSocket, WebSocketServer } from "ws";

export function serverWebSocketTransport(
  rawWs: WebSocket
): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const channel = createChannel<AgentMessage, void>();

      yield* spawn(function* () {
        for (const [event] of yield* each(on<[MessageEvent<string>]>(rawWs, "message"))) {
          yield* channel.send(parseAgentMessage(JSON.parse(event.data.toString())));
          yield* each.next();
        }
      });

      yield* spawn(function* () {
        yield* once(rawWs, 'close');
        yield* channel.close();
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

    const connected = withResolvers<WebSocket>();
    yield* spawn(function*() {
      const [browserWs] = yield* once<[WebSocket]>(wss, "connection");
      connected.resolve(browserWs);
    });

    const listening = withResolvers<void>();
    httpServer.listen(3000, listening.resolve);

    const addr = httpServer.address() as AddressInfo;
    console.log(`WebSocket server listening on ws://localhost:${addr.port}`);

    const browserWs = yield* connected.operation;
    console.log("Browser connected");

    try {
      yield* provide(browserWs);
    } finally {
      httpServer.close();
      wss.close();
    }
  });
}
