import { resource } from "effection";
import { useWebSocket } from "@effectionx/websocket";
import { map } from "@effectionx/stream-helpers";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory, HostMessage } from "../transport.js";

export interface WebSocketTransportOptions {
  url: string;
}

/**
 * Create a transport factory that connects to a WebSocket endpoint
 * and exchanges protocol messages as JSON text frames.
 */
export function websocketTransport(options: WebSocketTransportOptions): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const ws = yield* useWebSocket<string>(options.url);

      const receive = map(function* (event: MessageEvent<string>) {
        return parseAgentMessage(JSON.parse(event.data));
      })(ws);

      const transport = {
        *send(message: HostMessage) {
          ws.send(JSON.stringify(message));
        },
        receive,
      };

      yield* provide(transport);
    });
}
