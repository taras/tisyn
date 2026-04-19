/**
 * DPL-EXEC category tests (per-effect dispatch through Policy + EffectHandler).
 *
 *   - EXEC-01: executed effect result is captured on the EffectRequestRecord
 *   - EXEC-03: rejected effect records error/disposition
 *   - EXEC-05: deferred effect records disposition without dispatch
 *   - EXEC-07: surfaced_to_taras effect records disposition without dispatch
 *   - EXEC-09: no EffectHandler calls when the queue is empty
 *   - EXEC-11: per-effect appendEffectRequest preserves order
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, effect } from "./helpers/harness.js";

describe("DPL-EXEC", () => {
  it("EXEC-01/03/05/07/11: all four dispositions round-trip through per-effect appendEffectRequest", function* () {
    const effects = [
      effect("e-exec", { foo: 1 }),
      effect("e-rej", null),
      effect("e-def", null),
      effect("e-surf", null),
    ];

    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({
          display: "requesting effects",
          status: "done",
          requestedEffects: effects,
        }),
      ],
      gptScript: [],
      policyScript: [
        { kind: "executed" },
        { kind: "rejected", reason: "blocked" },
        { kind: "deferred", reason: "later" },
        { kind: "surfaced_to_taras", reason: "ask taras" },
      ],
      dispatchScript: [{ ok: true, result: { ok: true } }],
    });

    // Policy.decide called once per effect.
    const policyCalls = result.operations.filter(
      (op) => op.agent === "Policy" && op.op === "decide",
    );
    expect(policyCalls).toHaveLength(4);

    // EffectHandler.invoke called only for the executed entry.
    const invokeCalls = result.operations.filter(
      (op) => op.agent === "EffectHandler" && op.op === "invoke",
    );
    expect(invokeCalls).toHaveLength(1);
    expect(
      (invokeCalls[0].args as { effectId: string; data: unknown }).effectId,
    ).toBe("e-exec");

    // appendEffectRequest fired four times in order.
    expect(result.appendedEffectRequests).toHaveLength(4);
    expect(result.appendedEffectRequests.map((r) => r.disposition)).toEqual([
      "executed",
      "rejected",
      "deferred",
      "surfaced_to_taras",
    ]);

    // Executed record carries the dispatch result.
    expect(result.appendedEffectRequests[0].result).toEqual({ ok: true });
    // Rejected record carries the policy error.
    expect(result.appendedEffectRequests[1].error).toEqual({
      name: "PolicyRejected",
      message: "blocked",
    });
  });

  it("EXEC-09: no EffectHandler.invoke calls when requestedEffects is absent", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "no effects", status: "done" })],
      gptScript: [],
    });

    // EffectsQueue.seed was still called (workflow always seeds).
    const seedCalls = result.operations.filter(
      (op) => op.agent === "EffectsQueue" && op.op === "seed",
    );
    expect(seedCalls).toHaveLength(1);
    expect(
      (seedCalls[0].args as { effects: unknown[] }).effects,
    ).toEqual([]);

    // No policy or handler invocations.
    const policyCalls = result.operations.filter(
      (op) => op.agent === "Policy" && op.op === "decide",
    );
    expect(policyCalls).toHaveLength(0);
    const invokeCalls = result.operations.filter(
      (op) => op.agent === "EffectHandler" && op.op === "invoke",
    );
    expect(invokeCalls).toHaveLength(0);
    // No records appended.
    expect(result.appendedEffectRequests).toHaveLength(0);
  });
});
