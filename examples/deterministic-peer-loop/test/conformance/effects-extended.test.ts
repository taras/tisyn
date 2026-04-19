/**
 * DPL-EXEC extended tests.
 *
 *   - DPL-EXEC-02: deferred effects are not dispatched / no follow-up record
 *   - DPL-EXEC-06: exactly one EffectRequestRecord per requested effect
 *   - DPL-EXEC-08: dispositionAt >= turnIndex invariant holds
 *   - DPL-EXEC-10: surfaced_to_taras makes no further conformance claim
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, effect } from "./helpers/harness.js";
import type { EffectRequestRecord } from "../../src/types.js";

describe("DPL-EXEC extended", () => {
  it("EXEC-06/08: one record per request; dispositionAt >= turnIndex", function* () {
    const effects = [effect("e1", 1), effect("e2", 2), effect("e3", 3)];
    const records: EffectRequestRecord[] = effects.map((e, i) => ({
      turnIndex: 1,
      requestor: "opus",
      effect: e,
      disposition: "executed",
      dispositionAt: 1 + i,
      result: { index: i },
    }));

    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({
          display: "three effects",
          status: "done",
          requestedEffects: effects,
        }),
      ],
      gptScript: [],
      effectsScript: [records],
    });

    // Exactly one appended record per requested effect.
    expect(result.appendedEffectRequests).toHaveLength(effects.length);
    // dispositionAt >= turnIndex on every record.
    for (const r of result.appendedEffectRequests) {
      expect(r.dispositionAt).toBeGreaterThanOrEqual(r.turnIndex);
    }
  });

  it("EXEC-02: deferred disposition produces record without result/error", function* () {
    const records: EffectRequestRecord[] = [
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effect("e-def", null),
        disposition: "deferred",
        dispositionAt: 1,
      },
    ];

    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({
          display: "deferred ask",
          status: "done",
          requestedEffects: [effect("e-def", null)],
        }),
      ],
      gptScript: [],
      effectsScript: [records],
    });

    expect(result.appendedEffectRequests).toHaveLength(1);
    const rec = result.appendedEffectRequests[0];
    expect(rec.disposition).toBe("deferred");
    expect(rec.result).toBeUndefined();
    expect(rec.error).toBeUndefined();
  });

  it("EXEC-10: surfaced_to_taras appends record with that disposition and no execution", function* () {
    const records: EffectRequestRecord[] = [
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effect("e-surf", null),
        disposition: "surfaced_to_taras",
        dispositionAt: 1,
      },
    ];

    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({
          display: "surface please",
          status: "done",
          requestedEffects: [effect("e-surf", null)],
        }),
      ],
      gptScript: [],
      effectsScript: [records],
    });

    expect(result.appendedEffectRequests).toHaveLength(1);
    expect(result.appendedEffectRequests[0].disposition).toBe(
      "surfaced_to_taras",
    );
  });
});
