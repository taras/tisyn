// SS-RN: renderTestPlanMarkdown projects the coverage matrix and test cases.

import { describe, expect, it } from "vitest";
import { renderTestPlanMarkdown } from "./render-test-plan.ts";
import { fixtureAlphaPlan } from "../__fixtures__/index.ts";

describe("SS-RN render-test-plan", () => {
  it("emits a Coverage Matrix section with every rule row", () => {
    const out = renderTestPlanMarkdown(fixtureAlphaPlan);
    expect(out).toMatch(/## Coverage Matrix/);
    expect(out).toMatch(/\| A1 \| covered \| T-A-001 \|/);
    expect(out).toMatch(/\| A2 \| uncovered \|  \|/);
  });

  it("emits test cases formatted with [id] [priority] [type] (§ref)", () => {
    const out = renderTestPlanMarkdown(fixtureAlphaPlan);
    expect(out).toMatch(/- \[T-A-001\] \[p0\] \[unit\] \(§1\) A1 holds\./);
  });

  it("is deterministic", () => {
    expect(renderTestPlanMarkdown(fixtureAlphaPlan)).toBe(renderTestPlanMarkdown(fixtureAlphaPlan));
  });
});
