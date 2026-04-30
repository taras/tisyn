/**
 * DPL-MODE / DPL-DONE / DPL-GATE category tests (journal-only model).
 *
 *   - DPL-MODE-01: needs_taras → next cycle requires Taras input (required mode)
 *   - DPL-MODE-02: continue → next cycle is optional
 *   - DPL-MODE-03: done → no further cycles
 *   - DPL-DONE-01: status=done carries readOnlyReason="done" on terminal hydrate
 *   - DPL-DONE-02: done persists peer turn BEFORE the terminal hydrate
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

  it("DONE-01/02: done persists peer turn then terminal hydrate carries 'done'", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "final opus", status: "done" })],
      gptScript: [],
    });

    // The opus peer-turn append fires before the terminal hydrate.
    const peerAppendIdx = result.operations.findIndex(
      (op) =>
        op.agent === "Projection" && op.op === "appendMessage" && op.args.entry.speaker === "opus",
    );
    expect(peerAppendIdx).toBeGreaterThanOrEqual(0);

    const terminalHydrateIdx = (() => {
      for (let i = result.operations.length - 1; i >= 0; i = i - 1) {
        const op = result.operations[i];
        if (op.agent === "App" && op.op === "hydrate" && op.args.readOnlyReason === "done") {
          return i;
        }
      }
      return -1;
    })();
    expect(terminalHydrateIdx).toBeGreaterThan(peerAppendIdx);
    expect(result.exitReason).toBe("done");
  });
});
