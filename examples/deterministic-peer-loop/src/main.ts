/**
 * Deterministic peer-loop dev entrypoint.
 *
 * Boots the example by:
 *   1. Reading the journal file at JOURNAL_PATH and folding all
 *      prior `state-agent.transition` YieldEvents into the example-local
 *      authority via `authority.seed(...)`. The authority is then
 *      consistent with the workflow state at the end of the recorded
 *      run, so the workflow's first read (`StateAgent.readInitialState`)
 *      observes the same seeded state under live and replay.
 *   2. Calling `runDescriptorLocally` to start the workflow + servers.
 *   3. Holding the process open with `suspend()` so the WebSocket
 *      server keeps serving attached browsers after the workflow
 *      reaches a terminal state.
 *
 * No `publishFinalSnapshot` step: the App binding's
 * `createBinding()` (browser-agent.ts) installs an authority
 * subscription that fans out every accepted snapshot, and pushes
 * the current authority state to each newly-attached browser. A
 * late-arriving browser after a replayed/terminal run sees the
 * seeded state via that on-attach push.
 */

import { main, suspend } from "effection";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runDescriptorLocally } from "@tisyn/cli";
import { FileStream } from "@tisyn/durable-streams";
import { authority } from "./state-authority.js";
import type { AppState } from "./state-types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(__dirname, "./workflow.ts");

const journalPath = resolve(__dirname, "..", process.env.JOURNAL_PATH ?? "./data/peer-loop.ndjson");

await main(function* () {
  const stream = new FileStream(journalPath);
  const events = yield* stream.readAll();
  const seedStates: AppState[] = [];
  for (const event of events) {
    if (
      event.type === "yield" &&
      event.description.type === "state-agent" &&
      event.description.name === "transition" &&
      event.result.status === "ok"
    ) {
      seedStates.push(event.result.value as unknown as AppState);
    }
  }
  authority.seed(seedStates);

  yield* runDescriptorLocally(
    modulePath,
    function* () {
      yield* suspend();
    },
    { entrypoint: "dev" },
  );
});
