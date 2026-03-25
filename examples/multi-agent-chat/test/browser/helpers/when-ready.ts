import { when } from "@effectionx/converge";
import { call } from "effection";
import type { Operation } from "effection";
import { WebSocket } from "ws";

export function* whenReady(wsUrl: string, appUrl: string): Operation<void> {
  yield* when(
    function* () {
      // Probe WebSocket
      yield* call(
        () =>
          new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            ws.on("open", () => {
              ws.close();
              resolve();
            });
            ws.on("error", reject);
            setTimeout(() => {
              ws.close();
              reject(new Error("ws probe timeout"));
            }, 2000);
          }),
      );
      // Probe HTTP
      const res = yield* call(() => fetch(appUrl));
      if (res.status !== 200) throw new Error(`App returned ${res.status}`);
    },
    { timeout: 10000 },
  );
}
