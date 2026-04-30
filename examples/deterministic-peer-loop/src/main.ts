/**
 * Deterministic peer-loop dev entrypoint.
 *
 * Runs the workflow declared in `./workflow.ts` via the CLI's programmatic
 * helper, then publishes the workflow's `FinalSnapshot` into the App
 * binding's session mirror so browsers that attach after a completed-run
 * replay see the terminal transcript and control state. The server stays
 * alive (via `suspend()`) until the process is killed.
 */

import { main, suspend } from "effection";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runDescriptorLocally } from "@tisyn/cli";
import { getCurrentAppBinding } from "./browser-agent.js";
import type { FinalSnapshot } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(__dirname, "./workflow.ts");

await main(function* () {
  yield* runDescriptorLocally(
    modulePath,
    function* (finalValue) {
      const app = getCurrentAppBinding();
      if (app && finalValue !== null && typeof finalValue === "object") {
        app.publishFinalSnapshot(finalValue as unknown as FinalSnapshot);
      }
      yield* suspend();
    },
    { entrypoint: "dev" },
  );
});
