/**
 * Conformance tests — driven by fixtures from the spec.
 *
 * Each test runs a fixture through the harness and asserts PASS.
 */

import { describe, it, expect } from "vitest";
import { runFixture } from "./harness.js";
import {
  KERN_001,
  KERN_020,
  KERN_034,
  KERN_080,
  KERN_071,
  REPLAY_010,
  REPLAY_020,
  NEG_020,
  NEG_001,
  DET_005,
  KERN_014,
} from "./fixtures.js";

describe("Kernel evaluation", () => {
  it("KERN-001: Integer literal evaluates to itself", async () => {
    const result = await runFixture(KERN_001);
    expect(result.pass, result.message).toBe(true);
  });

  it("KERN-020: Let binds value and makes it available in body", async () => {
    const result = await runFixture(KERN_020);
    expect(result.pass, result.message).toBe(true);
  });

  it("KERN-034: Free variable resolves at call site, not definition site", async () => {
    const result = await runFixture(KERN_034);
    expect(result.pass, result.message).toBe(true);
  });

  it("DET-005: 0.1 + 0.2 float determinism", async () => {
    const result = await runFixture(DET_005);
    expect(result.pass, result.message).toBe(true);
  });

  it("KERN-014: Short-circuit suppresses right-side effect", async () => {
    const result = await runFixture(KERN_014);
    expect(result.pass, result.message).toBe(true);
  });
});

describe("Kernel effects", () => {
  it("KERN-080: Sequential effects with data dependency", async () => {
    const result = await runFixture(KERN_080);
    expect(result.pass, result.message).toBe(true);
  });

  it("KERN-071: Opaque value rule — env value resembling Ref not resolved", async () => {
    const result = await runFixture(KERN_071);
    expect(result.pass, result.message).toBe(true);
  });
});

describe("Replay", () => {
  it("REPLAY-010: Partial replay to live — first two replayed, third live", async () => {
    const result = await runFixture(REPLAY_010);
    expect(result.pass, result.message).toBe(true);
  });

  it("REPLAY-020: Divergence detection — mismatched effect type", async () => {
    const result = await runFixture(REPLAY_020);
    expect(result.pass, result.message).toBe(true);
  });
});

describe("Negative tests", () => {
  it("NEG-020: Eval node with numeric id is malformed", async () => {
    const result = await runFixture(NEG_020);
    expect(result.pass, result.message).toBe(true);
  });

  it("NEG-001: Ref to unbound name produces UnboundVariable", async () => {
    const result = await runFixture(NEG_001);
    expect(result.pass, result.message).toBe(true);
  });
});

describe("Stale-fixture coverage (RD-PD-097)", () => {
  it("RD-PD-097: a fixture whose expected_journal omits sha for a payload-sensitive effect MUST fail to match a runtime that journals sha", async () => {
    // Construct a stale fixture where the expected_journal description
    // for x.step1 omits the sha field. The runtime now journals
    // { type, name, input, sha }, so the harness's strict canonical
    // comparison rejects this fixture as nonconforming.
    const staleFixture = {
      id: "RD-PD-097",
      suite_version: "2.0.0",
      tier: "core" as const,
      level: 3,
      category: "kernel.replay.stale-fixture",
      spec_ref: "scoped-effects.13.12.14",
      type: "effect" as const,
      description: "Stale expected_journal entry without sha must fail to match",
      ir: { tisyn: "eval" as const, id: "x.step1", data: [] },
      env: {},
      effects: [
        {
          descriptor: { id: "x.step1", data: [] },
          result: { status: "ok" as const, value: 10 },
        },
      ],
      expected_result: { status: "ok" as const, value: 10 },
      expected_journal: [
        {
          coroutineId: "root",
          // Intentionally stale: missing input/sha.
          description: { type: "x", name: "step1" },
          result: { status: "ok" as const, value: 10 },
          type: "yield" as const,
        },
        {
          coroutineId: "root",
          result: { status: "ok" as const, value: 10 },
          type: "close" as const,
        },
      ],
    };
    const result = await runFixture(staleFixture);
    expect(result.pass).toBe(false);
    // The harness should report a description-shape mismatch.
    expect(result.message).toMatch(/journal|description/i);
  });
});
