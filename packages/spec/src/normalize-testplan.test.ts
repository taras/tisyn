// SS-NTP — Normalization (test plan) tests per §5.4 of
// spec-system-test-plan.source.md.

import { describe, expect, test } from "vitest";
import { DependsOn, TestCase, TestCategory, TestPlan } from "./constructors.ts";
import { Status, Tier } from "./enums.ts";
import { normalizeTestPlan } from "./normalize.ts";
import type { TestPlanModule } from "./types.ts";

function validPlan(): TestPlanModule {
  return TestPlan({
    id: "sp-x-tp",
    title: "X Test Plan",
    version: "0.1.0",
    status: Status.Active,
    testsSpec: DependsOn("sp-x", "0.1.0"),
    categories: [
      TestCategory({
        id: "cat1",
        title: "C",
        tests: [
          TestCase({
            id: "X-T1",
            tier: Tier.Core,
            rules: ["X-R1"],
            description: "d",
            setup: "s",
            expected: "e",
          }),
        ],
      }),
    ],
    coreTier: 1,
    extendedTier: 0,
  });
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) {
    throw new Error("expected ok result");
  }
  return result.value;
}

describe("SS-NTP", () => {
  test("SS-NTP-001 Normalized test plan has _hash and _normalizedAt (N1,D39)", () => {
    const normalized = unwrap(normalizeTestPlan(validPlan()));
    expect(typeof normalized._hash).toBe("string");
    expect(normalized._hash.startsWith("sha256:")).toBe(true);
    expect(typeof normalized._normalizedAt).toBe("string");
    expect(new Date(normalized._normalizedAt).toISOString()).toBe(normalized._normalizedAt);
  });

  test("SS-NTP-002 Normalized test plan does NOT have _sectionNumbering", () => {
    const normalized = unwrap(normalizeTestPlan(validPlan()));
    expect("_sectionNumbering" in normalized).toBe(false);
  });

  test("SS-NTP-003 Normalized test plan does NOT have _ruleLocations", () => {
    const normalized = unwrap(normalizeTestPlan(validPlan()));
    expect("_ruleLocations" in normalized).toBe(false);
  });

  test("SS-NTP-004 Test-plan authored fields preserved (N2,LB2)", () => {
    const authored = validPlan();
    const snapshot = JSON.parse(JSON.stringify(authored));
    const normalized = unwrap(normalizeTestPlan(authored));
    expect(authored).toEqual(snapshot); // input not mutated
    expect(normalized.id).toBe(authored.id);
    expect(normalized.categories).toEqual(authored.categories);
    expect(normalized.coreTier).toBe(authored.coreTier);
    expect(normalized.extendedTier).toBe(authored.extendedTier);
    expect(normalized.testsSpec).toEqual(authored.testsSpec);
  });

  test("SS-NTP-005 Test-plan hash is deterministic across runs (N6)", () => {
    const a = unwrap(normalizeTestPlan(validPlan()));
    const b = unwrap(normalizeTestPlan(validPlan()));
    expect(a._hash).toBe(b._hash);
  });
});
