/**
 * WebSocket transport adapter.
 *
 * Sends dispatch requests as JSON messages over a WebSocket connection
 * and awaits JSON responses.
 */

import type { Operation } from "effection";
import { useWebSocket } from "@effectionx/websocket";
import { each } from "effection";
import type { Val } from "@tisyn/shared";
import type { Transport } from "../transport.js";

/**
 * JSON-RPC-style message sent to the agent over WebSocket.
 */
interface DispatchRequest {
  type: "dispatch";
  id: number;
  operation: string;
  args: Val;
}

/**
 * JSON-RPC-style response from the agent over WebSocket.
 */
interface DispatchResponse {
  type: "dispatch-response";
  id: number;
  status: "ok" | "err";
  value?: Val;
  error?: { name: string; message: string };
}

/**
 * Create a WebSocket transport that connects to a remote agent.
 *
 * Each dispatch call sends a JSON request and waits for the matching response.
 */
export function websocket(url: string): Transport {
  let socket: ReturnType<typeof useWebSocket<string>> extends Operation<infer T> ? T : never;
  let requestId = 0;
  const pending = new Map<number, {
    resolve: (value: Val) => void;
    reject: (error: Error) => void;
  }>();

  return {
    *dispatch(operation: string, args: Val): Operation<Val> {
      if (!socket) {
        // Lazily connect on first dispatch
        socket = yield* useWebSocket<string>(url);

        // Start a background listener for responses
        // This is a simplified approach - in production you'd use
        // a proper subscription
      }

      const id = requestId++;
      const request: DispatchRequest = {
        type: "dispatch",
        id,
        operation,
        args,
      };

      return yield* {
        *[Symbol.iterator]() {
          socket.send(JSON.stringify(request));

          // Listen for the matching response
          for (const event of yield* each(socket)) {
            const response: DispatchResponse = JSON.parse(event.data);
            if (response.type === "dispatch-response" && response.id === id) {
              if (response.status === "ok") {
                return response.value as Val;
              }
              const err = new Error(response.error?.message ?? "Agent error");
              if (response.error?.name) err.name = response.error.name;
              throw err;
            }
            yield* each.next();
          }

          throw new Error("WebSocket closed before receiving response");
        },
      };
    },
  };
}
