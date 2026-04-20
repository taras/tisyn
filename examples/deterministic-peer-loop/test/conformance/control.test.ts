/**
 * DPL-CTRL / DPL-OVR / DPL-RES category tests (journal-only model).
 *
 *   - DPL-CTRL-01: stopRequested → final hydrate readOnlyReason="stopped", no peer step
 *   - DPL-CTRL-03: paused + stopRequested → no peer step, readOnlyReason="stopped"
 *   - DPL-OVR-01: nextSpeakerOverride consumed and cleared via Projection.applyControlPatch
 *   - DPL-OVR-02: override overrides default alternation for one cycle
 *   - DPL-RES-01: hydrate fires every cycle (state is re-observed each iteration)
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, gptTurn } from "./helpers/harness.js";

describe("DPL-CTRL / DPL-OVR / DPL-RES", () => {
  it("CTRL-01: stopRequested before first peer step exits with readOnlyReason='stopped'", function* () {
    const result = yield* runHarness({
      seededInitialControl: { paused: false, stopRequested: true },
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "should-not-fire", status: "continue" })],
      gptScript: [],
    });

    // No peer dispatch happened.
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(0);

    // Final hydrate carries readOnlyReason="stopped".
    const last = result.hydrateSnapshots[result.hydrateSnapshots.length - 1];
    expect(last.readOnlyReason).toBe("stopped");
    expect(result.exitReason).toBe("stopped");
  });

  it("CTRL-03: paused+stopRequested from the start exits via stop, skips peer", function* () {
    const result = yield* runHarness({
      seededInitialControl: { paused: true, stopRequested: true },
      tarasMessages: ["only"],
      opusScript: [opusTurn({ display: "should-not-fire", status: "continue" })],
      gptScript: [],
    });

    // Stop beats pause: no peer call, exit with reason "stopped".
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(0);
    expect(result.exitReason).toBe("stopped");
  });

  it("OVR-01/02: nextSpeakerOverride routes and is cleared via applyControlPatch", function* () {
    // Default alternation would start with opus. Override to gpt for first turn.
    const result = yield* runHarness({
      seededInitialControl: {
        paused: false,
        stopRequested: false,
        nextSpeakerOverride: "gpt",
      },
      tarasMessages: ["please"],
      opusScript: [],
      gptScript: [gptTurn({ display: "gpt first", status: "done" })],
    });

    // First peer call is GPT (overridden).
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(1);
    expect(peerCalls[0].agent).toBe("GptAgent");

    // Projection.applyControlPatch called with clear patch ({ nextSpeakerOverride: null }).
    const clearCall = result.operations.find(
      (op) =>
        op.agent === "Projection" &&
        op.op === "applyControlPatch" &&
        op.args.patch.nextSpeakerOverride === null,
    );
    expect(clearCall).toBeDefined();
  });

  it("RES-01: hydrate fires every cycle so browser observes live state", function* () {
    const result = yield* runHarness({
      tarasMessages: ["a", "b"],
      opusScript: [opusTurn({ display: "o1", status: "continue" })],
      gptScript: [gptTurn({ display: "g1", status: "done" })],
    });

    // Two peer cycles → at least two hydrate dispatches (one per iteration
    // start) plus a terminal hydrate carrying readOnlyReason="done".
    expect(result.hydrateSnapshots.length).toBeGreaterThanOrEqual(3);
    const last = result.hydrateSnapshots[result.hydrateSnapshots.length - 1];
    expect(last.readOnlyReason).toBe("done");
  });
});
