import { once } from "@effectionx/node";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory } from "@tisyn/transport";
import type { Stream } from "effection";
import {
  createChannel,
  createSignal,
  Operation,
  resource,
  spawn,
  withResolvers,
  each,
} from "effection";
import { on } from "@effectionx/node";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { logInfo, logError, logDebug } from "./logger.js";

function logInboundMessage(msg: AgentMessage): void {
  if ("result" in msg && !("error" in msg)) {
    const result = msg.result as Record<string, unknown>;
    if ("sessionId" in result) {
      // InitializeResponse
      logInfo("browser", "initialized", { id: msg.id, sessionId: result.sessionId });
    } else if ("ok" in result && result.ok === false) {
      // ExecuteResponse with error
      logError("browser", "execute error", { id: msg.id, error: result.error });
    } else {
      // ExecuteResponse (ok)
      const value = "value" in result ? result.value : result;
      logInfo("browser", "execute result", { id: msg.id, value: summarizeValue(value) });
    }
  } else if ("error" in msg) {
    // Protocol error (InitializeProtocolError or ExecuteProtocolError)
    logError("browser", "protocol error", { id: (msg as { id: unknown }).id, error: msg.error });
  } else if ("method" in msg) {
    // ProgressNotification
    logDebug("browser", "progress", msg.params as Record<string, unknown>);
  } else {
    logError("browser", "unknown message type", { raw: msg as Record<string, unknown> });
  }
}

function logOutboundMessage(msg: HostMessage): void {
  if ("method" in msg) {
    switch (msg.method) {
      case "initialize":
        logInfo("browser", "send initialize", { id: msg.id, agentId: msg.params.agentId });
        break;
      case "execute":
        logInfo("browser", "send execute", { id: msg.id, operation: msg.params.operation });
        break;
      case "cancel":
      case "shutdown":
        logInfo("browser", msg.method);
        break;
    }
  }
}

function summarizeValue(value: unknown): unknown {
  if (value && typeof value === "object" && "message" in (value as Record<string, unknown>)) {
    return { message: (value as Record<string, unknown>).message };
  }
  return value;
}

export function serverWebSocketTransport(
  rawWs: WebSocket
): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const channel = createChannel<AgentMessage, void>();

      yield* spawn(function* () {
        for (const [event] of yield* each(on<[MessageEvent<string>]>(rawWs, "message"))) {
          logDebug("browser", "raw inbound", { data: event.data.toString() });
          const msg = parseAgentMessage(JSON.parse(event.data.toString()));
          logInboundMessage(msg);
          yield* channel.send(msg);
          yield* each.next();
        }
      });

      yield* spawn(function* () {
        yield* once(rawWs, 'close');
        logInfo("browser", "disconnected — pending operations will fail (reconnect does not resume workflow)");
        yield* channel.close();
      })

      try {
        yield* provide({
          *send(msg: HostMessage) {
            logOutboundMessage(msg);
            rawWs.send(JSON.stringify(msg));
          },
          receive: channel,
        });
      } finally {
        yield* channel.close();
      }
    });
}

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
    logInfo("browser", `WebSocket server listening on ws://localhost:${addr.port}`);

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
