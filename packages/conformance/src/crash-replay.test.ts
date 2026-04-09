/**
 * End-to-end crash/replay test.
 *
 * Simulates a crash mid-workflow:
 * 1. Start execution with 3 sequential effects
 * 2. Complete 2 effects, journal 2 Yields
 * 3. Simulate crash (discard kernel state, keep journal)
 * 4. Create fresh execution with same IR + stored journal
 * 5. Verify: 2 effects replay (no agent calls), 3rd dispatches live
 * 6. Verify: final journal matches expected
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Effects } from "@tisyn/agent";

describe("End-to-end crash/replay", () => {
  it("should replay stored effects and continue with live dispatch", function* () {
    // IR: three sequential effects
    // const a = yield* x.step1([]);
    // const b = yield* x.step2([a]);
    // const c = yield* x.step3([b]);
    // return c;
    const ir = {
      tisyn: "eval",
      id: "let",
      data: {
        tisyn: "quote",
        expr: {
          name: "a",
          value: { tisyn: "eval", id: "x.step1", data: [] },
          body: {
            tisyn: "eval",
            id: "let",
            data: {
              tisyn: "quote",
              expr: {
                name: "b",
                value: {
                  tisyn: "eval",
                  id: "x.step2",
                  data: [{ tisyn: "ref", name: "a" }],
                },
                body: {
                  tisyn: "eval",
                  id: "let",
                  data: {
                    tisyn: "quote",
                    expr: {
                      name: "c",
                      value: {
                        tisyn: "eval",
                        id: "x.step3",
                        data: [{ tisyn: "ref", name: "b" }],
                      },
                      body: { tisyn: "ref", name: "c" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // ── First run: complete 2 effects, then "crash" ──
    const firstRunStream = new InMemoryStream();

    const firstResult = yield* scoped(function* () {
      let firstRunCallCount = 0;
      yield* Effects.around({
        *dispatch([_effectId, _data]: [string, any]) {
          firstRunCallCount++;
          if (firstRunCallCount === 1) {
            return 10;
          }
          if (firstRunCallCount === 2) {
            return 20;
          }
          // "Crash" on the 3rd call — simulate by throwing
          throw new Error("SIMULATED_CRASH");
        },
      });

      return yield* execute({
        ir: ir as never,
        stream: firstRunStream,
      });
    });

    // First run should have error result (crashed on step3)
    expect(firstResult.result.status).toBe("error");

    // Journal: 2 yield(ok) + 1 yield(err) for step3 + 1 close(err)
    const firstSnapshot = firstRunStream.snapshot();
    expect(firstSnapshot.length).toBe(4);
    expect(firstSnapshot[0]!.type).toBe("yield");
    expect(firstSnapshot[1]!.type).toBe("yield");
    expect(firstSnapshot[2]!.type).toBe("yield"); // step3 yield(err)
    expect(firstSnapshot[3]!.type).toBe("close");

    // ── Second run: replay from stored journal ──
    // Include ONLY the 2 successful Yield events for replay.
    // The yield(err) and close(err) from the crashed run are discarded —
    // we want to re-execute from the crash point.
    const replayStream = new InMemoryStream([firstSnapshot[0]!, firstSnapshot[1]!]);

    let secondRunCallCount = 0;
    const secondResult = yield* scoped(function* () {
      yield* Effects.around({
        *dispatch([_effectId, _data]: [string, any]) {
          secondRunCallCount++;
          // This should only be called for step3 (the live effect)
          return 30; // step3 result
        },
      });

      return yield* execute({
        ir: ir as never,
        stream: replayStream,
      });
    });

    // Verify: only 1 live agent call (step3)
    expect(secondRunCallCount).toBe(1);

    // Verify: success result
    expect(secondResult.result).toEqual({ status: "ok", value: 30 });

    // Verify: full journal has all 3 yields + close
    expect(secondResult.journal.length).toBe(4);
    expect(secondResult.journal[0]!.type).toBe("yield");
    expect(secondResult.journal[1]!.type).toBe("yield");
    expect(secondResult.journal[2]!.type).toBe("yield");
    expect(secondResult.journal[3]!.type).toBe("close");

    // Verify descriptions
    const y1 = secondResult.journal[0] as {
      type: "yield";
      description: { type: string; name: string };
    };
    const y2 = secondResult.journal[1] as {
      type: "yield";
      description: { type: string; name: string };
    };
    const y3 = secondResult.journal[2] as {
      type: "yield";
      description: { type: string; name: string };
    };
    expect(y1.description).toEqual({ type: "x", name: "step1" });
    expect(y2.description).toEqual({ type: "x", name: "step2" });
    expect(y3.description).toEqual({ type: "x", name: "step3" });
  });
});
