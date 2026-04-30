import { describe, it, expect, beforeEach } from "vitest";
import { EMPTY_APP_STATE, authority, mergeControlPatch } from "../../src/state-authority.js";
import type { AppState, TransitionProposal } from "../../src/state-types.js";
import type { LoopControl } from "../../src/schemas.js";

describe("state-authority", () => {
  beforeEach(() => {
    authority.reset();
  });

  describe("seed", () => {
    it("starts at EMPTY_APP_STATE before any seed", () => {
      expect(authority.getState()).toEqual(EMPTY_APP_STATE);
    });

    it("seeds to the last entry's accepted state without firing subscribers", () => {
      const seen: AppState[] = [];
      authority.subscribe((s) => seen.push(s));

      const stateA: AppState = {
        ...EMPTY_APP_STATE,
        messages: [{ speaker: "taras", content: "a" }],
      };
      const stateB: AppState = {
        ...EMPTY_APP_STATE,
        messages: [
          { speaker: "taras", content: "a" },
          { speaker: "opus", content: "b" },
        ],
      };
      authority.seed([stateA, stateB]);

      expect(authority.getState()).toEqual(stateB);
      expect(seen).toEqual([]);
    });

    it("treats empty seed as no-op", () => {
      authority.seed([]);
      expect(authority.getState()).toEqual(EMPTY_APP_STATE);
    });
  });

  describe("accept", () => {
    it("applies append-message and notifies subscribers", () => {
      const seen: AppState[] = [];
      authority.subscribe((s) => seen.push(s));

      const result = authority.accept({
        tag: "append-message",
        entry: { speaker: "taras", content: "hi" },
      });

      expect(result.accepted.messages).toEqual([{ speaker: "taras", content: "hi" }]);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(result.accepted);
    });

    it("applies apply-control-patch via mergeControlPatch", () => {
      const result = authority.accept({
        tag: "apply-control-patch",
        patch: { paused: true },
      });
      expect(result.accepted.control.paused).toBe(true);
      expect(result.accepted.control.stopRequested).toBe(false);
    });

    it("applies append-peer-record", () => {
      const record = {
        turnIndex: 1,
        speaker: "opus" as const,
        status: "continue" as const,
        data: null,
      };
      const result = authority.accept({ tag: "append-peer-record", record });
      expect(result.accepted.peerRecords).toEqual([record]);
    });

    it("applies append-effect-request", () => {
      const record = {
        turnIndex: 1,
        requestor: "opus" as const,
        effect: { id: "x", input: null },
        disposition: "deferred" as const,
        dispositionAt: 1,
      };
      const result = authority.accept({ tag: "append-effect-request", record });
      expect(result.accepted.effectRequests).toEqual([record]);
    });

    it("applies set-read-only", () => {
      const result = authority.accept({ tag: "set-read-only", reason: "done" });
      expect(result.accepted.readOnlyReason).toBe("done");
    });

    it("returns proposal alongside accepted state", () => {
      const proposal: TransitionProposal = {
        tag: "append-message",
        entry: { speaker: "taras", content: "x" },
      };
      const result = authority.accept(proposal);
      expect(result.proposal).toBe(proposal);
    });
  });

  describe("subscribe", () => {
    it("returns an unsubscribe handle", () => {
      const seen: AppState[] = [];
      const off = authority.subscribe((s) => seen.push(s));
      authority.accept({ tag: "set-read-only", reason: "a" });
      off();
      authority.accept({ tag: "set-read-only", reason: "b" });
      expect(seen).toHaveLength(1);
    });
  });

  describe("mergeControlPatch", () => {
    it("merges paused / stopRequested", () => {
      const current: LoopControl = { paused: false, stopRequested: false };
      expect(mergeControlPatch(current, { paused: true })).toEqual({
        paused: true,
        stopRequested: false,
      });
    });

    it("clears nextSpeakerOverride when patched with null", () => {
      const current: LoopControl = {
        paused: false,
        stopRequested: false,
        nextSpeakerOverride: "opus",
      };
      const next = mergeControlPatch(current, { nextSpeakerOverride: null });
      expect(next.nextSpeakerOverride).toBeUndefined();
    });

    it("preserves existing nextSpeakerOverride when patch omits it", () => {
      const current: LoopControl = {
        paused: false,
        stopRequested: false,
        nextSpeakerOverride: "gpt",
      };
      const next = mergeControlPatch(current, { paused: true });
      expect(next.nextSpeakerOverride).toBe("gpt");
    });
  });
});
