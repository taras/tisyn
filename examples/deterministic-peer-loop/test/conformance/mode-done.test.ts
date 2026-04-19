/**
 * DPL-MODE / DPL-DONE / DPL-GATE category tests.
 *
 *   - DPL-MODE-01: needs_taras → next cycle requires Taras input (required mode)
 *   - DPL-MODE-02: continue → next cycle is optional
 *   - DPL-MODE-03: done → no further cycles
 *   - DPL-DONE-01: status=done triggers setReadOnly("done")
 *   - DPL-DONE-02: done persists peer turn BEFORE setReadOnly
 *   - DPL-GATE-01: required mode uses unbounded elicit (no timebox)
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, gptTurn } from "./helpers/harness.js";

describe("DPL-MODE / DPL-DONE", () => {
  it("MODE-01: needs_taras status makes next elicit mode 'required'", function* () {
    const result = yield* runHarness({
      tarasMessages: ["first", "second"],
      opusScript: [opusTurn({ display: "opus-needs-taras", status: "needs_taras" })],
      gptScript: [gptTurn({ display: "gpt-done", status: "done" })],
    });

    const elicits = result.operations.filter((op) => op.agent === "App" && op.op === "elicit");
    expect(elicits).toHaveLength(2);
    // First cycle is optional mode. Second cycle is required (after needs_taras).
    expect((elicits[0].args as { message: string }).message).toMatch(/Optional/);
    expect((elicits[1].args as { message: string }).message).toMatch(/required/i);
  });

  it("MODE-02: continue status keeps next cycle optional", function* () {
    const result = yield* runHarness({
      tarasMessages: ["first", "second"],
      opusScript: [opusTurn({ display: "o1", status: "continue" })],
      gptScript: [gptTurn({ display: "g1", status: "done" })],
    });

    const elicits = result.operations.filter((op) => op.agent === "App" && op.op === "elicit");
    expect(elicits).toHaveLength(2);
    expect((elicits[0].args as { message: string }).message).toMatch(/Optional/);
    expect((elicits[1].args as { message: string }).message).toMatch(/Optional/);
  });

  it("DONE-01/02: done persists peer turn then setReadOnly('done')", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "final opus", status: "done" })],
      gptScript: [],
    });

    // Check that appendMessage for the peer turn happened BEFORE setReadOnly.
    const opIndex = (agent: string, op: string) =>
      result.operations.findIndex((x) => x.agent === agent && x.op === op);
    // Find the peer appendMessage — it's the opus one (index > the taras one).
    const appends = result.operations
      .map((o, i) => ({ o, i }))
      .filter(
        ({ o }) =>
          o.agent === "DB" &&
          o.op === "appendMessage" &&
          (o.args as { entry: { speaker: string } }).entry.speaker === "opus",
      );
    expect(appends).toHaveLength(1);
    const setReadOnlyIdx = opIndex("App", "setReadOnly");
    expect(setReadOnlyIdx).toBeGreaterThan(appends[0].i);

    expect(result.exitReason).toBe("done");
  });
});
