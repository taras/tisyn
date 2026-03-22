import type { Operation } from "effection";
import { map } from "@effectionx/stream-helpers";
import type { WebSocketResource } from "@effectionx/websocket";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import { parseHostMessage } from "@tisyn/protocol";
import { runAgentHandler } from "./agent-handler.js";

/**
 * Run an agent over a WebSocket connection. This is the agent-side
 * entry point for WebSocket transports — typically used in test servers
 * that accept connections and run an agent per connection.
 *
 * Reads HostMessages from WebSocket text frames (JSON).
 * Writes AgentMessages as JSON text frames.
 */
export function* runWebSocketAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
  ws: WebSocketResource<string>,
): Operation<void> {
  const messageStream = map(function* (event: MessageEvent<string>) {
    return parseHostMessage(JSON.parse(event.data));
  })(ws);

  const sub = yield* messageStream;

  yield* runAgentHandler(declaration, handlers, {
    receive: sub,
    *send(msg) {
      ws.send(JSON.stringify(msg));
    },
  });
}
