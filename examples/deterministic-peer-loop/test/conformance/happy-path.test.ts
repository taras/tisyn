/**
 * Happy-path conformance tests (journal-only model).
 *
 *   - DPL-INIT: first hydrate snapshot reflects the workflow's starting state
 *   - DPL-ALT-01/02: default alternation opus → gpt
 *   - DPL-PER-01/02/03/07: TurnEntry + PeerRecord persistence via Projection
 *   - DPL-MODE-02: status=continue → tarasMode=optional
 *   - DPL-DONE-01/03: status=done → final hydrate carries readOnlyReason="done"
 *   - DPL-STEP-01: at most one peer step per cycle
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { runHarness, opusTurn, gptTurn } from "./helpers/harness.js";

describe("DPL happy path", () => {
  it("starts empty, runs opus → gpt → done, hydrates per iteration", function* () {
    const result = yield* runHarness({
      tarasMessages: ["go opus", "continue"],
      opusScript: [opusTurn({ display: "opus reply 1", status: "continue" })],
      gptScript: [gptTurn({ display: "gpt reply 1", status: "done" })],
    });

    // INIT: the very first hydrate snapshot has an empty transcript — the
    // workflow owns its state and starts fresh every run (replay-driven
    // restoration rebuilds state from journaled agent-op returns, not from
    // binding-side warm-start reads).
    expect(result.hydrateSnapshots.length).toBeGreaterThan(0);
    expect(result.hydrateSnapshots[0].messages).toEqual([]);
    expect(result.hydrateSnapshots[0].readOnlyReason).toBeNull();

    // ALT: Opus took first turn, Gpt took second.
    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    expect(peerCalls.map((op) => op.agent)).toEqual(["OpusAgent", "GptAgent"]);

    // PER: each Taras message and each peer turn produced a Projection.appendMessage.
    expect(result.appendedMessages.map((m) => m.speaker)).toEqual([
      "taras",
      "opus",
      "taras",
      "gpt",
    ]);
    expect(result.appendedMessages.map((m) => m.content)).toEqual([
      "go opus",
      "opus reply 1",
      "continue",
      "gpt reply 1",
    ]);

    // The final hydrate snapshot carries the full transcript the workflow built.
    const finalSnapshot = result.hydrateSnapshots[result.hydrateSnapshots.length - 1];
    expect(finalSnapshot.messages.map((m) => m.speaker)).toEqual([
      "taras",
      "opus",
      "taras",
      "gpt",
    ]);

    // PER: PeerRecord appended per peer step with incremented turnIndex.
    expect(result.appendedPeerRecords.map((r) => r.turnIndex)).toEqual([1, 2]);
    expect(result.appendedPeerRecords.map((r) => r.speaker)).toEqual(["opus", "gpt"]);
    expect(result.appendedPeerRecords.map((r) => r.status)).toEqual(["continue", "done"]);

    // DONE-01/03: the terminal hydrate carries readOnlyReason="done".
    expect(finalSnapshot.readOnlyReason).toBe("done");
    expect(result.exitReason).toBe("done");
    expect(result.terminatedByMaxTurns).toBe(false);
  });

  it("STEP-01: exactly one peer step per cycle", function* () {
    const result = yield* runHarness({
      tarasMessages: ["one"],
      opusScript: [opusTurn({ display: "op1", status: "done" })],
      gptScript: [],
    });

    const peerCalls = result.operations.filter(
      (op) => op.agent === "OpusAgent" || op.agent === "GptAgent",
    );
    // One elicit cycle → one peer step → done.
    expect(peerCalls).toHaveLength(1);
    expect(peerCalls[0].agent).toBe("OpusAgent");
  });
});
