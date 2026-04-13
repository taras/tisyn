// Integration tests for the structured tisyn-cli test plan corpus.

import { describe, expect, test } from "vitest";
import { normalizeSpec, normalizeTestPlan } from "../../src/normalize.ts";
import { buildRegistry } from "../../src/registry.ts";
import { checkCoverage, isReady } from "../../src/validate.ts";
import { tisynCliSpec } from "./spec.ts";
import { tisynCliTestPlan } from "./test-plan.ts";

describe("tisyn-cli corpus test plan", () => {
  test("normalizes without structural errors", () => {
    const result = normalizeTestPlan(tisynCliTestPlan);
    if (!result.ok) {
      throw new Error(`normalize failed: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  test("spec + plan build a ready registry with no uncovered rules", () => {
    const specResult = normalizeSpec(tisynCliSpec);
    const planResult = normalizeTestPlan(tisynCliTestPlan);
    if (!specResult.ok || !planResult.ok) {
      throw new Error("normalize failed");
    }
    const registry = buildRegistry([specResult.value], [planResult.value]);
    const report = checkCoverage(registry, "tisyn-cli");
    expect(report.errors).toEqual([]);
    expect(report.uncoveredRules).toEqual([]);
    expect(isReady(registry, "tisyn-cli")).toBe(true);
  });
});
