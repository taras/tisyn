import { describe, it, beforeAll } from "@effectionx/vitest";
import { runScenario } from "./helpers/scenario.js";
import { assertLocalListenSupported } from "./helpers/preflight.js";
import {
  basicSendReceive,
  transcriptRestoresAfterReload,
  hostRestartPreservesState,
  secondBrowserIsReadOnly,
} from "./workflows.generated.js";

describe("Browser acceptance", () => {
  beforeAll(function* () {
    yield* assertLocalListenSupported();
  });

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
