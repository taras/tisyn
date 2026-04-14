import { describe, expect, test } from "vitest";
import { buildReviewPrompt, parseVerdict } from "./claude-reviewer.ts";

const emptySummary = '{ "missingSections": [] }';

describe("buildReviewPrompt", () => {
  test("includes both sides, summaries, and preamble", () => {
    const prompt = buildReviewPrompt({
      originalSpec: "ORIG SPEC",
      originalPlan: "ORIG PLAN",
      generatedSpec: "GEN SPEC",
      generatedPlan: "GEN PLAN",
      specCompareSummary: emptySummary,
      planCompareSummary: emptySummary,
    });
    expect(prompt).toContain("VERDICT: PASS");
    expect(prompt).toContain("ORIG SPEC");
    expect(prompt).toContain("GEN SPEC");
    expect(prompt).toContain("ORIG PLAN");
    expect(prompt).toContain("GEN PLAN");
    expect(prompt).toContain("STRUCTURAL COMPARISON SUMMARY (spec)");
    expect(prompt).toContain("STRUCTURAL COMPARISON SUMMARY (test plan)");
  });

  test("omitted planCompareSummary emits the SKIPPED notice", () => {
    const prompt = buildReviewPrompt({
      originalSpec: "ORIG SPEC",
      originalPlan: "ORIG PLAN",
      generatedSpec: "GEN SPEC",
      generatedPlan: "GEN PLAN",
      specCompareSummary: emptySummary,
    });
    expect(prompt).toContain("STRUCTURAL COMPARISON SUMMARY (test plan)");
    expect(prompt).toContain(
      "SKIPPED — TestPlanModule cannot express the handwritten outer prose sections.",
    );
  });
});

describe("parseVerdict", () => {
  test("first-line PASS returns true", () => {
    expect(parseVerdict("VERDICT: PASS\nok")).toBe(true);
  });
  test("leading blank lines before PASS returns true", () => {
    expect(parseVerdict("\n\nVERDICT: PASS\n...")).toBe(true);
  });
  test("surrounding whitespace on PASS line returns true", () => {
    expect(parseVerdict("  VERDICT: PASS  \nreason")).toBe(true);
  });
  test("FAIL returns false", () => {
    expect(parseVerdict("VERDICT: FAIL\n...")).toBe(false);
  });
  test("unrelated first line returns false", () => {
    expect(parseVerdict("nothing relevant here")).toBe(false);
  });
  test("empty string returns false", () => {
    expect(parseVerdict("")).toBe(false);
  });
});
