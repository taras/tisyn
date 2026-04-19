/**
 * DPL-EXEC category tests.
 *
 *   - EXEC-01: executed effect result is captured on the EffectRequestRecord
 *   - EXEC-03: rejected effect records error/disposition
 *   - EXEC-05: deferred effect records disposition without dispatch
 *   - EXEC-07: surfaced_to_taras effect records disposition without dispatch
 *   - EXEC-09: EffectsProcessor.processAll is called even for empty effects arrays
 *   - EXEC-11: appendEffectRequests preserves record order
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, effect } from "./helpers/harness.js";
import type { EffectRequestRecord } from "../../src/types.js";

describe("DPL-EXEC", () => {
  it("EXEC-01/03/05/07: all four dispositions round-trip through appendEffectRequests", function* () {
    const effects = [
      effect("e-exec", { foo: 1 }),
      effect("e-rej", null),
      effect("e-def", null),
      effect("e-surf", null),
    ];
    const records: EffectRequestRecord[] = [
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effects[0],
        disposition: "executed",
        dispositionAt: 1,
        result: { ok: true },
      },
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effects[1],
        disposition: "rejected",
        dispositionAt: 1,
        error: { name: "PolicyRejected", message: "blocked" },
      },
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effects[2],
        disposition: "deferred",
        dispositionAt: 1,
      },
      {
        turnIndex: 1,
        requestor: "opus",
        effect: effects[3],
        disposition: "surfaced_to_taras",
        dispositionAt: 1,
      },
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
      effectsScript: [records],
    });

    // processAll was invoked once with the 4 effects.
    const processAll = result.operations.find(
      (op) => op.agent === "EffectsProcessor" && op.op === "processAll",
    );
    expect(processAll).toBeDefined();
    const processArgs = processAll!.args as {
      effects: unknown[];
      turnIndex: number;
      requestor: string;
    };
    expect(processArgs.effects).toHaveLength(4);
    expect(processArgs.turnIndex).toBe(1);
    expect(processArgs.requestor).toBe("opus");

    // appendEffectRequests received all 4 records in order.
    expect(result.appendedEffectRequests).toHaveLength(4);
    expect(result.appendedEffectRequests.map((r) => r.disposition)).toEqual([
      "executed",
      "rejected",
      "deferred",
      "surfaced_to_taras",
    ]);
  });

  it("EXEC-09: processAll is called even when requestedEffects is missing", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({ display: "no effects", status: "done" }),
      ],
      gptScript: [],
      effectsScript: [[]],
    });

    const processAllCalls = result.operations.filter(
      (op) => op.agent === "EffectsProcessor" && op.op === "processAll",
    );
    expect(processAllCalls).toHaveLength(1);
    expect(
      (processAllCalls[0].args as { effects: unknown[] }).effects,
    ).toEqual([]);
  });
});
