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

describe("DPL-EXEC extended", () => {
  it("EXEC-06/08: one record per request; dispositionAt >= turnIndex", function* () {
    const effects = [effect("e1", 1), effect("e2", 2), effect("e3", 3)];

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
      policyScript: [
        { kind: "executed" },
        { kind: "executed" },
        { kind: "executed" },
      ],
      dispatchScript: [
        { ok: true, result: { index: 0 } },
        { ok: true, result: { index: 1 } },
        { ok: true, result: { index: 2 } },
      ],
    });

    expect(result.appendedEffectRequests).toHaveLength(effects.length);
    for (const r of result.appendedEffectRequests) {
      expect(r.dispositionAt).toBeGreaterThanOrEqual(r.turnIndex);
    }
  });

  it("EXEC-02: deferred disposition produces record without result/error, no dispatch", function* () {
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
      policyScript: [{ kind: "deferred", reason: "wait" }],
    });

    expect(result.appendedEffectRequests).toHaveLength(1);
    const rec = result.appendedEffectRequests[0];
    expect(rec.disposition).toBe("deferred");
    expect(rec.result).toBeUndefined();
    expect(rec.error).toBeUndefined();

    // No EffectHandler.invoke for deferred.
    const invokeCalls = result.operations.filter(
      (op) => op.agent === "EffectHandler" && op.op === "invoke",
    );
    expect(invokeCalls).toHaveLength(0);
  });

  it("EXEC-10: surfaced_to_taras appends record with that disposition and no execution", function* () {
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
      policyScript: [{ kind: "surfaced_to_taras" }],
    });

    expect(result.appendedEffectRequests).toHaveLength(1);
    expect(result.appendedEffectRequests[0].disposition).toBe(
      "surfaced_to_taras",
    );

    const invokeCalls = result.operations.filter(
      (op) => op.agent === "EffectHandler" && op.op === "invoke",
    );
    expect(invokeCalls).toHaveLength(0);
  });
});
