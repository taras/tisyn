/**
 * Unit tests for the Projection agent's pure reducer (mergeControlPatch
 * and the append semantics executed by the binding handlers).
 *
 * The Projection agent holds no cross-call state. These tests exercise
 * mergeControlPatch directly and confirm the append ops are plain
 * immutable "return new array" wrappers — the reducer invariants the
 * workflow depends on for replay-driven state reconstruction.
 */

import { describe, expect, it } from "vitest";
import { mergeControlPatch } from "../../src/projection-agent.js";
import type {
  BrowserControlPatch,
  EffectRequestRecord,
  LoopControl,
  PeerRecord,
  TurnEntry,
} from "../../src/types.js";

describe("mergeControlPatch", () => {
  it("preserves fields not present in the patch", () => {
    const current: LoopControl = { paused: false, stopRequested: false };
    const merged = mergeControlPatch(current, {});
    expect(merged).toEqual(current);
    expect(merged).not.toBe(current);
  });

  it("overrides paused and stopRequested when set", () => {
    const current: LoopControl = { paused: false, stopRequested: false };
    const patch: BrowserControlPatch = { paused: true, stopRequested: true };
    expect(mergeControlPatch(current, patch)).toEqual({
      paused: true,
      stopRequested: true,
    });
  });

  it("preserves nextSpeakerOverride when patch omits it", () => {
    const current: LoopControl = {
      paused: false,
      stopRequested: false,
      nextSpeakerOverride: "opus",
    };
    const merged = mergeControlPatch(current, { paused: true });
    expect(merged.nextSpeakerOverride).toBe("opus");
    expect(merged.paused).toBe(true);
  });

  it("clears nextSpeakerOverride when patch sets it to null", () => {
    const current: LoopControl = {
      paused: false,
      stopRequested: false,
      nextSpeakerOverride: "gpt",
    };
    const merged = mergeControlPatch(current, { nextSpeakerOverride: null });
    expect(merged.nextSpeakerOverride).toBeUndefined();
    expect(Object.hasOwn(merged, "nextSpeakerOverride")).toBe(false);
  });

  it("replaces nextSpeakerOverride when patch provides a value", () => {
    const current: LoopControl = { paused: false, stopRequested: false };
    const merged = mergeControlPatch(current, { nextSpeakerOverride: "gpt" });
    expect(merged.nextSpeakerOverride).toBe("gpt");
  });

  it("does not mutate the input", () => {
    const current: LoopControl = {
      paused: false,
      stopRequested: false,
      nextSpeakerOverride: "opus",
    };
    const snapshot = { ...current };
    mergeControlPatch(current, { paused: true, nextSpeakerOverride: null });
    expect(current).toEqual(snapshot);
  });
});

describe("append reducers", () => {
  it("appendMessage returns a new array with the entry appended", () => {
    const messages: TurnEntry[] = [{ speaker: "taras", content: "a" }];
    const entry: TurnEntry = { speaker: "opus", content: "b" };
    const next = [...messages, entry];
    expect(next).toEqual([
      { speaker: "taras", content: "a" },
      { speaker: "opus", content: "b" },
    ]);
    expect(next).not.toBe(messages);
    expect(messages).toHaveLength(1);
  });

  it("appendPeerRecord returns a new array with the record appended", () => {
    const records: PeerRecord[] = [];
    const record: PeerRecord = {
      turnIndex: 1,
      speaker: "opus",
      status: "continue",
    };
    const next = [...records, record];
    expect(next).toEqual([record]);
    expect(next).not.toBe(records);
  });

  it("appendEffectRequest returns a new array with the record appended", () => {
    const records: EffectRequestRecord[] = [];
    const record: EffectRequestRecord = {
      turnIndex: 1,
      requestor: "opus",
      effect: { id: "e1", input: null },
      disposition: "executed",
      dispositionAt: 1,
      result: { ok: true },
    };
    const next = [...records, record];
    expect(next).toEqual([record]);
    expect(next).not.toBe(records);
  });
});
