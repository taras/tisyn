/**
 * App agent — local transport with WebSocket server binding.
 *
 * Shares the persistence store with the DB binding via getOrCreateStore.
 * The session manager mirrors transcript and LoopControl state so observers
 * and reconnects hydrate without workflow re-dispatch.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding, LocalServerBinding } from "@tisyn/transport";
import { createSignal, each, spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { Value } from "@sinclair/typebox/value";
import { BrowserToHostSchema, type BrowserToHost } from "./schemas.js";
import { BrowserSessionManager } from "./browser-session.js";
import { getOrCreateStore } from "./store.js";
import type { LoopControl, TurnEntry } from "./schemas.js";
import { logInfo } from "./logger.js";

export const App = () =>
  agent("app", {
    elicit: operation<{ message: string }, { message: string }>(),
    showMessage: operation<{ entry: TurnEntry }, void>(),
    readControl: operation<Record<string, never>, LoopControl>(),
    loadChat: operation<{ messages: TurnEntry[] }, void>(),
    setReadOnly: operation<{ reason: string }, void>(),
  });

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const dbPath = (config?.dbPath as string) ?? "./data/peer-loop.json";
  const store = getOrCreateStore(dbPath);

  const userInput = createSignal<string, never>();
  const session = new BrowserSessionManager({
    onUserMessage(message) {
      userInput.send(message);
    },
    onUpdateControl(patch) {
      const current = store.loadControl();
      const next: LoopControl = {
        paused: patch.paused ?? current.paused,
        stopRequested: patch.stopRequested ?? current.stopRequested,
      };
      if (patch.nextSpeakerOverride === null) {
        // explicit clear — leave field absent on persisted record
      } else if (patch.nextSpeakerOverride !== undefined) {
        next.nextSpeakerOverride = patch.nextSpeakerOverride;
      } else if (current.nextSpeakerOverride !== undefined) {
        next.nextSpeakerOverride = current.nextSpeakerOverride;
      }
      store.writeControl(next);
    },
  });

  session.publishControl(store.loadControl());
  store.subscribe((event) => {
    if (event.kind === "control") {
      session.publishControl(event.control);
    }
  });

  return {
    transport: inprocessTransport(App(), {
      *elicit({ message }) {
        const sub = yield* userInput;
        session.beginElicit(message);
        try {
          const item = yield* sub.next();
          return { message: item.value };
        } finally {
          session.endElicit();
        }
      },
      *showMessage({ entry }) {
        session.showMessage(entry);
      },
      *readControl() {
        return store.loadControl();
      },
      *loadChat({ messages }) {
        session.loadChat(messages);
      },
      *setReadOnly({ reason }) {
        session.setReadOnly(reason);
      },
    }),

    *bindServer(server: LocalServerBinding) {
      if (!server.connections) {
        return;
      }

      yield* spawn(function* () {
        for (const connection of yield* each(server.connections!)) {
          yield* spawn(function* () {
            const ws = yield* connection;
            logInfo("browser-agent", "WebSocket connected, waiting for connect message");

            const firstMsg = yield* waitForFirstMessage(ws);
            if (firstMsg.type === "connect") {
              session.attach(firstMsg.clientSessionId, ws);
            } else {
              logInfo("browser-agent", "first message was not connect, closing");
              ws.close();
              return;
            }

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
  const { operation, resolve, reject } = withResolvers<BrowserToHost>();
  const handler = (data: import("ws").RawData) => {
    ws.off("message", handler);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch (err) {
      reject(err as Error);
      return;
    }
    if (!Value.Check(BrowserToHostSchema, parsed)) {
      reject(new Error("invalid first message"));
      return;
    }
    resolve(parsed as BrowserToHost);
  };
  ws.on("message", handler);
  return operation;
}
