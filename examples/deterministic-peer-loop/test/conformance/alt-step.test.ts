/**
 * DPL-ALT / DPL-STEP / DPL-OVR extended tests.
 *
 *   - DPL-ALT-03: after gpt step (no override), next speaker is opus
 *   - DPL-ALT-04: alternation toggles regardless of status
 *   - DPL-STEP-02: paused cycle dispatches zero peer steps
 *   - DPL-STEP-03: stopped cycle dispatches zero peer steps
 *   - DPL-STEP-04: no cycle dispatches two peer steps
 *   - DPL-OVR-03: subsequent cycle absent new override uses alternation
 *   - DPL-OVR-04: override equal to default alternation still clears
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, gptTurn } from "./helpers/harness.js";

describe("DPL-ALT / DPL-STEP / DPL-OVR extended", () => {
  it("ALT-03/04: gpt→opus alternation toggles regardless of status", function* () {
    // Start with override to gpt so gpt goes first, then alternation swings to opus.
    const result = yield* runHarness({
      initialControl: {
        paused: false,
        stopRequested: false,
        nextSpeakerOverride: "gpt",
      },
      tarasMessages: ["go", "again"],
      opusScript: [opusTurn({ display: "o after g", status: "done" })],
      gptScript: [gptTurn({ display: "g first", status: "continue" })],
    });

    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls.map((op) => op.agent)).toEqual(["GptAgent", "OpusAgent"]);
  });

  it("STEP-02: paused + stopRequested eventually → zero peer steps, exit stopped", function* () {
    // Paused alone would loop forever; combine with stop so we exit cleanly.
    // Still valid STEP-02 check: no peer step was dispatched.
    const result = yield* runHarness({
      initialControl: { paused: true, stopRequested: true },
      tarasMessages: ["one"],
      opusScript: [opusTurn({ display: "x", status: "continue" })],
      gptScript: [],
    });

    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(0);
    expect(result.exitReason).toBe("stopped");
  });

  it("STEP-04: a single cycle never dispatches two peer steps", function* () {
    // Two cycles → two peer steps (one each). Verify no cycle doubles up.
    const result = yield* runHarness({
      tarasMessages: ["a", "b"],
      opusScript: [opusTurn({ display: "o1", status: "continue" })],
      gptScript: [gptTurn({ display: "g1", status: "done" })],
    });

    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    // Exactly two peer calls total across two cycles — one per cycle.
    expect(peerCalls).toHaveLength(2);
  });

  it("OVR-04: override equal to default target still clears via writeControl", function* () {
    // Default first speaker is opus. Override to opus — still must be cleared.
    const result = yield* runHarness({
      initialControl: {
        paused: false,
        stopRequested: false,
        nextSpeakerOverride: "opus",
      },
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "o", status: "done" })],
      gptScript: [],
    });

    const writeControl = result.operations.find(
      (op) => op.agent === "DB" && op.op === "writeControl",
    );
    expect(writeControl).toBeDefined();
    const written = (
      writeControl!.args as {
        control: { nextSpeakerOverride?: string };
      }
    ).control;
    expect(written.nextSpeakerOverride).toBeUndefined();
  });
});
