import { describe, it } from "@effectionx/vitest";
import { runScenario } from "./helpers/scenario.js";
import {
  basicSendReceive,
  transcriptRestoresAfterReload,
  hostRestartPreservesState,
  secondBrowserIsReadOnly,
} from "./workflows.generated.js";

describe("Browser acceptance", () => {
  it("basic send and receive", function* () {
    yield* runScenario(basicSendReceive);
  });

  it("transcript restores after reload", function* () {
    yield* runScenario(transcriptRestoresAfterReload);
  });

  it("host restart preserves state", function* () {
    yield* runScenario(hostRestartPreservesState);
  });

  it("second browser is read-only", function* () {
    yield* runScenario(secondBrowserIsReadOnly);
  });
});
