import { when } from "@effectionx/converge";
import { call, resource, withResolvers } from "effection";
import type { Operation } from "effection";
import { WebSocket } from "ws";

function probeWebSocket(url: string): Operation<void> {
  return resource(function* (provide) {
    const ws = new WebSocket(url);
    const ready = withResolvers<void>();

    ws.on("open", () => ready.resolve());
    ws.on("error", (err) => ready.reject(err));

    try {
      yield* ready.operation;
      yield* provide(undefined);
    } finally {
      ws.close();
    }
  });
}

export function* whenReady(wsUrl: string, appUrl: string): Operation<void> {
  yield* when(
    function* () {
      yield* probeWebSocket(wsUrl);

      const res = yield* call(() => fetch(appUrl));
      if (res.status !== 200) {
        throw new Error(`App returned ${res.status}`);
      }
    },
    { timeout: 10000 },
  );
}
