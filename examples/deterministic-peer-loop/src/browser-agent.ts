/**
 * App agent — local transport with WebSocket server binding.
 *
 * Surface: `elicit` + `nextControlPatch`. The `hydrate` op is removed
 * by the State Primitive Spike — browser snapshot fanout is now driven
 * by the example-local state authority's subscription mechanism, not
 * by a workflow-yielded hydrate call.
 *
 * On `createBinding()` the binding installs a single
 * `authority.subscribe(snapshot => session.applySnapshot(snapshot))`
 * so every accepted transition fans out to attached browsers. On the
 * first session attach (and post-replay terminal-state attach) the
 * binding pushes `session.applySnapshot(authority.getState())` so a
 * late-arriving browser sees the seeded state without any explicit
 * publishFinalSnapshot driver step.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding, LocalServerBinding } from "@tisyn/transport";
import { createSignal, each, spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { Value } from "@sinclair/typebox/value";
import { BrowserToHostSchema, type BrowserControlPatch, type BrowserToHost } from "./schemas.js";
import { BrowserSessionManager } from "./browser-session.js";
import { authority } from "./state-authority.js";
import { logInfo } from "./logger.js";

export const App = () =>
  agent("app", {
    elicit: operation<{ message: string }, { message: string }>(),
    nextControlPatch: operation<Record<string, never>, BrowserControlPatch>(),
  });

export function createBinding(_config?: Record<string, unknown>): LocalAgentBinding {
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

  // Authority subscription: every accepted transition fans out as a
  // full-snapshot apply. The unsubscribe handle is held in module scope
  // for the binding's lifetime — process exit drops it implicitly.
  authority.subscribe((snapshot) => {
    session.applySnapshot(snapshot);
  });

  // First-attach / late-attach broadcast: when a session attaches with
  // no prior live transitions in this run (replay completed end-to-end
  // without firing the binding), the seeded authority state still
  // needs to reach the browser. Push the current snapshot once on
  // attach.
  const pushSeededSnapshotOnAttach = () => {
    session.applySnapshot(authority.getState());
  };

  const binding: LocalAgentBinding = {
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
              pushSeededSnapshotOnAttach();
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
