/**
 * DPL-PER / DPL-RES / DPL-INIT extended tests (journal-only model).
 *
 *   - DPL-PER-04: Taras-origin messages persist with speaker "taras"
 *   - DPL-PER-05: no PeerRecord for Taras-origin messages
 *   - DPL-PER-06: PeerTurnResult.usage passes through to TurnEntry
 *   - DPL-PER-07: peer TurnEntry omits the `usage` key when the result has none
 *   - DPL-RES-02: status drives termination, not display text
 *   - DPL-INIT-03: absent LoopControl initializes defaults
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, gptTurn } from "./helpers/harness.js";

describe("DPL-PER / DPL-RES / DPL-INIT extended", () => {
  it("PER-04/05: Taras messages persist as speaker=taras with no PeerRecord", function* () {
    const result = yield* runHarness({
      tarasMessages: ["hello from taras"],
      opusScript: [opusTurn({ display: "hi taras", status: "done" })],
      gptScript: [],
    });

    // Taras message appended with speaker "taras".
    const tarasAppends = result.appendedMessages.filter((m) => m.speaker === "taras");
    expect(tarasAppends).toHaveLength(1);
    expect(tarasAppends[0].content).toBe("hello from taras");

    // Peer records only for peer steps — no record has "taras" speaker.
    const tarasPeerRecords = result.appendedPeerRecords.filter(
      (r) => (r.speaker as string) === "taras",
    );
    expect(tarasPeerRecords).toHaveLength(0);
    expect(result.appendedPeerRecords).toHaveLength(1);
    expect(result.appendedPeerRecords[0].speaker).toBe("opus");
  });

  it("PER-06: usage field passes through on peer TurnEntry when present", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [
        opusTurn({
          display: "with usage",
          status: "done",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
      ],
      gptScript: [],
    });

    const opusMsg = result.appendedMessages.find((m) => m.speaker === "opus");
    expect(opusMsg).toBeDefined();
    expect(opusMsg!.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("PER-07: peer TurnEntry omits the usage key when the result has no usage", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "no usage", status: "done" })],
      gptScript: [],
    });

    const opusMsg = result.appendedMessages.find((m) => m.speaker === "opus");
    expect(opusMsg).toBeDefined();
    expect(Object.hasOwn(opusMsg!, "usage")).toBe(false);

    // The final hydrate snapshot carries the same entry — no present-but-undefined usage.
    const finalSnapshot = result.hydrateSnapshots[result.hydrateSnapshots.length - 1];
    const opusEntry = finalSnapshot.messages.find((m) => m.speaker === "opus");
    expect(opusEntry).toBeDefined();
    expect(Object.hasOwn(opusEntry!, "usage")).toBe(false);
  });

  it("RES-02: status drives termination, not display containing literal 'done'", function* () {
    const result = yield* runHarness({
      tarasMessages: ["a", "b"],
      opusScript: [opusTurn({ display: "task is done-ish but not really", status: "continue" })],
      gptScript: [gptTurn({ display: "ok stopping", status: "done" })],
    });

    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(2);
    expect(result.exitReason).toBe("done");
  });

  it("INIT-03: workflow runs with defaulted control when none supplied", function* () {
    // No seededInitialControl → harness defaults to DEFAULT_LOOP_CONTROL.
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "ok", status: "done" })],
      gptScript: [],
    });

    // readInitialControl was invoked exactly once at workflow startup.
    const inits = result.operations.filter(
      (op) => op.agent === "Projection" && op.op === "readInitialControl",
    );
    expect(inits).toHaveLength(1);

    // A peer step ran, confirming defaults did not gate the loop off.
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(1);
    expect(result.exitReason).toBe("done");
  });
});
