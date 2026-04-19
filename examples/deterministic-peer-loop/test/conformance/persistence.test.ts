/**
 * DPL-PER / DPL-RES / DPL-INIT extended tests.
 *
 *   - DPL-PER-04: Taras-origin messages persist with speaker "taras"
 *   - DPL-PER-05: no PeerRecord for Taras-origin messages
 *   - DPL-PER-06: PeerTurnResult.usage passes through to TurnEntry
 *   - DPL-RES-02: status drives termination, not display text
 *   - DPL-INIT-03: absent LoopControl initializes defaults
 *   - DPL-INIT-04: App.loadChat dispatched with DB.loadMessages output (covered in happy-path)
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
    const tarasAppends = result.appendedMessages.filter(
      (m) => m.speaker === "taras",
    );
    expect(tarasAppends).toHaveLength(1);
    expect(tarasAppends[0].content).toBe("hello from taras");

    // Peer records only for peer steps — no record has "taras" speaker.
    const tarasPeerRecords = result.appendedPeerRecords.filter(
      (r) => (r.speaker as string) === "taras",
    );
    expect(tarasPeerRecords).toHaveLength(0);
    // Exactly one peer record (the opus turn).
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

  it("RES-02: status drives termination, not display containing literal 'done'", function* () {
    // display contains "done" but status is "continue" — workflow MUST NOT terminate.
    const result = yield* runHarness({
      tarasMessages: ["a", "b"],
      opusScript: [
        opusTurn({ display: "task is done-ish but not really", status: "continue" }),
      ],
      gptScript: [gptTurn({ display: "ok stopping", status: "done" })],
    });

    // Two peer calls occurred — the first's "done" text did not terminate.
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(2);
    expect(result.exitReason).toBe("done");
  });

  it("INIT-03: workflow runs with defaulted control when none supplied", function* () {
    // No initialControl → harness defaults to { paused: false, stopRequested: false }.
    // Verify the workflow reads it and proceeds normally.
    const result = yield* runHarness({
      tarasMessages: ["go"],
      opusScript: [opusTurn({ display: "ok", status: "done" })],
      gptScript: [],
    });

    const readControl = result.operations.find(
      (op) => op.agent === "App" && op.op === "readControl",
    );
    expect(readControl).toBeDefined();
    // A peer step ran, confirming defaults did not gate the loop off.
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls).toHaveLength(1);
    expect(result.exitReason).toBe("done");
  });
});
