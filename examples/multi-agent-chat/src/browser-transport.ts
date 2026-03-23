/**
 * Server-side WebSocket transport for the browser agent.
 *
 * Wraps a raw server-side WebSocket connection into an AgentTransport
 * so the browser agent can be installed via installRemoteAgent().
 * The browser implements the JSON-RPC agent protocol in vanilla JS.
 */

import { resource, useScope, createChannel, spawn } from "effection";
import type { AgentTransportFactory } from "@tisyn/transport";
import type { HostMessage, AgentMessage } from "@tisyn/protocol";
import { parseAgentMessage } from "@tisyn/protocol";
import type { WebSocket } from "ws";

export function serverWebSocketTransport(rawWs: WebSocket): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const scope = yield* useScope();
      const channel = createChannel<AgentMessage, void>();

      rawWs.on("message", (data) => {
        const msg = parseAgentMessage(JSON.parse(data.toString()));
        scope.run(function* () {
          yield* channel.send(msg);
        });
      });

      rawWs.on("close", () => {
        scope.run(function* () {
          yield* channel.close();
        });
      });

      yield* provide({
        *send(msg: HostMessage) {
          rawWs.send(JSON.stringify(msg));
        },
        receive: channel,
      });
    });
}
