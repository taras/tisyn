/**
 * App agent — local transport with WebSocket server binding.
 *
 * Surface: `elicit` + `nextControlPatch` + `hydrate`.
 * - `elicit` blocks on the owner-submitted user message (same pattern as before).
 * - `nextControlPatch` blocks on a buffered queue of control patches submitted
 *   by the owner; each call returns exactly one buffered patch (blocking until
 *   one is available).
 * - `hydrate({messages, control, readOnlyReason})` pushes the current
 *   workflow-owned snapshot into the session-manager mirror and broadcasts to
 *   attached browsers. Called once per main-loop iteration; during replay all
 *   but the frontier `hydrate` are replayed from the journal and never reach
 *   the binding.
 *
 * The binding owns no durable state. It does not read the journal. A
 * non-agent `publishFinalSnapshot(snapshot)` method is exposed for the driver
 * module (`main.ts`) to publish the replay-owned final snapshot after a
 * completed journal replays end-to-end without live dispatch.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding, LocalServerBinding } from "@tisyn/transport";
import { createSignal, each, spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { Value } from "@sinclair/typebox/value";
import {
  BrowserToHostSchema,
  type BrowserControlPatch,
  type BrowserToHost,
  type LoopControl,
  type TurnEntry,
} from "./schemas.js";
import { BrowserSessionManager } from "./browser-session.js";
import { logInfo } from "./logger.js";

export const App = () =>
  agent("app", {
    elicit: operation<{ message: string }, { message: string }>(),
    nextControlPatch: operation<Record<string, never>, BrowserControlPatch>(),
    hydrate: operation<
      {
        messages: TurnEntry[];
        control: LoopControl;
        readOnlyReason: string | null;
      },
      void
    >(),
  });

/**
 * Public handle returned by {@link createBinding}. The driver module holds a
 * reference via {@link getCurrentAppBinding} and may call
 * {@link publishFinalSnapshot} after `runtime.execute(...)` returns.
 */
export interface AppBindingHandle extends LocalAgentBinding {
  publishFinalSnapshot(snapshot: {
    messages: TurnEntry[];
    control: LoopControl;
    readOnlyReason: string | null;
  }): void;
}

let currentAppBinding: AppBindingHandle | null = null;

export function getCurrentAppBinding(): AppBindingHandle | null {
  return currentAppBinding;
}

export function createBinding(_config?: Record<string, unknown>): AppBindingHandle {
  const userInput = createSignal<string, never>();

  // Control-patch queue with a wake-up signal. Patches arrive via the
  // session-manager hook (synchronous, from the WebSocket message handler);
  // the agent operation drains one per call, blocking when empty.
  const controlPatches: BrowserControlPatch[] = [];
  const patchReady = createSignal<void, never>();

  const session = new BrowserSessionManager({
    onUserMessage(message) {
      userInput.send(message);
    },
    onUpdateControl(patch) {
      controlPatches.push(patch);
      patchReady.send();
    },
  });

  const applySnapshot = (snapshot: {
    messages: TurnEntry[];
    control: LoopControl;
    readOnlyReason: string | null;
  }): void => {
    session.loadChat(snapshot.messages);
    session.publishControl(snapshot.control);
    if (snapshot.readOnlyReason !== null) {
      session.setReadOnly(snapshot.readOnlyReason);
    }
  };

  const binding: AppBindingHandle = {
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
      *nextControlPatch() {
        const sub = yield* patchReady;
        while (controlPatches.length === 0) {
          yield* sub.next();
        }
        return controlPatches.shift()!;
      },
      *hydrate(snapshot) {
        applySnapshot(snapshot);
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

    publishFinalSnapshot(snapshot) {
      applySnapshot(snapshot);
    },
  };

  currentAppBinding = binding;
  return binding;
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
