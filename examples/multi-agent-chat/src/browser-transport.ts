import type { Stream } from "effection";
import { createSignal, Operation, resource, spawn, withResolvers, each } from "effection";
import { on } from "@effectionx/node";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { logInfo } from "./logger.js";

export function useConnection(rawWs: WebSocket): Operation<WebSocket> {
  return resource(function* (provide) {
    try {
      yield* provide(rawWs);
    } finally {
      rawWs.close();
    }
  });
}

export function useWebSocketServer(): Operation<Stream<Operation<WebSocket>, never>> {
  return resource(function* (provide) {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    const listening = withResolvers<void>();
    httpServer.listen(3000, listening.resolve);
    yield* listening.operation;

    const addr = httpServer.address() as AddressInfo;
    logInfo("host", `WebSocket server listening on ws://localhost:${addr.port}`);

    const signal = createSignal<Operation<WebSocket>, never>();

    yield* spawn(function* () {
      for (const [rawWs] of yield* each(on<[WebSocket]>(wss, "connection"))) {
        signal.send(useConnection(rawWs));
        yield* each.next();
      }
    });

    try {
      yield* provide(signal);
    } finally {
      httpServer.closeAllConnections();
      httpServer.close();
      wss.close();
    }
  });
}
