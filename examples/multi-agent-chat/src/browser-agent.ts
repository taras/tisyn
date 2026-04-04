/**
 * App agent — local transport with WebSocket server binding.
 *
 * The transport handles agent operations (elicit, showAssistantMessage, etc.)
 * backed by a BrowserSessionManager. The bindServer hook accepts browser
 * connections from the CLI's server binding.
 */

import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding, LocalServerBinding } from "@tisyn/transport";
import { each, spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { App } from "./workflow.generated.js";
import { BrowserSessionManager } from "./browser-session.js";
import type { BrowserToHost } from "./browser-session.js";
import { logInfo } from "./logger.js";

export function createBinding(): LocalAgentBinding {
  const session = new BrowserSessionManager();

  return {
    transport: inprocessTransport(App(), {
      *elicit({ input }) {
        return yield* session.elicit(input.message);
      },
      *showAssistantMessage({ input }) {
        session.showAssistantMessage(input.message);
      },
      *loadChat({ messages }) {
        session.loadChat(messages);
      },
      *setReadOnly({ input }) {
        session.setReadOnly(input.reason);
      },
    }),

    *bindServer(server: LocalServerBinding) {
      if (!server.connections) return;

      yield* spawn(function* () {
        for (const connection of yield* each(server.connections!)) {
          yield* spawn(function* () {
            const ws = yield* connection;
            logInfo("browser-agent", "WebSocket connected, waiting for connect message");

            // Wait for the first message (must be a connect)
            const firstMsg = yield* waitForFirstMessage(ws);
            if (firstMsg.type === "connect") {
              session.attach(firstMsg.clientSessionId, ws);
            } else {
              logInfo("browser-agent", "first message was not connect, closing");
              ws.close();
              return;
            }

            // Block until socket closes — ws is an Effection resource that
            // closes on scope exit, detach happens via close listener in attach()
            const closed = withResolvers<void>();
            ws.on("close", () => closed.resolve());
            yield* closed.operation;
          });
          yield* each.next();
        }
      });
    },
  };
}

function waitForFirstMessage(ws: import("ws").WebSocket): Operation<BrowserToHost> {
  const { operation, resolve } = withResolvers<BrowserToHost>();
  const handler = (data: import("ws").RawData) => {
    ws.off("message", handler);
    resolve(JSON.parse(data.toString()));
  };
  ws.on("message", handler);
  return operation;
}
