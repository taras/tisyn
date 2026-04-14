// Integration tests for the structured tisyn-cli test plan corpus.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { compareMarkdown } from "../../src/markdown/compare.ts";
import { renderTestPlanMarkdown } from "../../src/markdown/render-test-plan.ts";
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

  test("structured plan round-trips through compareMarkdown against the frozen fixture", () => {
    // Primary proof that the CLI test-plan round-trip gap is closed:
    // rendering the structured plan and feeding it plus the frozen
    // fixture through compareMarkdown produces zero structural diffs.
    const specResult = normalizeSpec(tisynCliSpec);
    const planResult = normalizeTestPlan(tisynCliTestPlan);
    if (!specResult.ok || !planResult.ok) {
      throw new Error("normalize failed");
    }
    const ruleSections = new Map<string, string>();
    for (const rule of specResult.value.rules) {
      ruleSections.set(rule.id, rule.section);
    }
    const generatedPlan = renderTestPlanMarkdown(planResult.value, {
      ruleSection: (id) => ruleSections.get(id),
      validatesLabel: specResult.value.title,
    });
    const originalPlan = readFileSync(
      resolve(import.meta.dirname, "__fixtures__/original-test-plan.md"),
      "utf8",
    );
    const report = compareMarkdown(originalPlan, generatedPlan);
    expect(report.summary.missingSections).toEqual([]);
    expect(report.summary.extraSections).toEqual([]);
    expect(report.summary.missingTestIds).toEqual([]);
    expect(report.summary.extraTestIds).toEqual([]);
    expect(report.summary.missingCoverageRefs).toEqual([]);
    expect(report.summary.extraCoverageRefs).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
