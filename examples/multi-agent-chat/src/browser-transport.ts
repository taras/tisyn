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
        logInfo("browser", "disconnected");
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

export function useWebSocketServer(): Operation<WebSocket> {
  return resource(function* (provide) {
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
    logInfo("browser", `WebSocket server listening on ws://localhost:${addr.port}`);

    const browserWs = yield* connected.operation;
    logInfo("browser", "connected");

    try {
      yield* provide(browserWs);
    } finally {
      httpServer.close();
      wss.close();
    }
  });
}
