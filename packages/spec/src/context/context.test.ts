// SS-CA: context assemblers are pure compositions over query primitives.
// Every result carries scopeKind mirroring the registry's scope.

import { describe, expect, it } from "vitest";
import {
  assembleAmendmentContext,
  assembleAuthoringContext,
  assembleConsistencyContext,
  assembleReviewContext,
  assembleTestPlanContext,
} from "./index.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureDelta,
} from "../__fixtures__/index.ts";

const r = buildTestRegistry([fixtureAlpha, fixtureBeta, fixtureDelta], [fixtureAlphaPlan]);

describe("SS-CA authoring", () => {
  it("sets scopeKind and carries relevantSpecs", () => {
    const ctx = assembleAuthoringContext(r, { topic: "hello" });
    expect(ctx.task).toBe("authoring");
    expect(ctx.scopeKind).toBe("full");
    expect(ctx.topic).toBe("hello");
    expect(ctx.relevantSpecs.length).toBeGreaterThan(0);
  });

  it("includes constraints when targetSpec provided", () => {
    const ctx = assembleAuthoringContext(r, { targetSpec: "fixture-alpha" });
    expect(ctx.targetSpec).toBe("fixture-alpha");
    expect(ctx.constraints?.targetSpecId).toBe("fixture-alpha");
  });
});

describe("SS-CA amendment", () => {
  it("carries blockingQuestions scoped to targetSpec", () => {
    const ctx = assembleAmendmentContext(r, { targetSpec: "fixture-delta" });
    expect(ctx.task).toBe("amendment");
    expect(ctx.blockingQuestions.map((q) => q.openQuestion.id)).toContain("OQ-D-1");
  });
});

describe("SS-CA review", () => {
  it("bundles dependencies, terms, coverage, readiness", () => {
    const ctx = assembleReviewContext(r, { targetSpec: "fixture-alpha" });
    expect(ctx.task).toBe("review");
    expect(ctx.coverage.specId).toBe("fixture-alpha");
    expect(ctx.readiness.specId).toBe("fixture-alpha");
    expect(ctx.dependents.map((d) => d.specId)).toContain("fixture-beta");
  });
});

describe("SS-CA test-plan", () => {
  it("partitions rules by level (must-not folds into must, should-not into should)", () => {
    const ctx = assembleTestPlanContext(r, { targetSpec: "fixture-alpha" });
    expect(ctx.mustRules.map((l) => l.rule.id)).toEqual(["A1"]);
    expect(ctx.shouldRules.map((l) => l.rule.id)).toEqual(["A2"]);
    expect(ctx.totalRuleCount).toBe(
      ctx.mustRules.length + ctx.shouldRules.length + ctx.mayRules.length,
    );
  });
});

describe("SS-CA consistency", () => {
  it("emits coverage + readiness summaries for every in-scope spec", () => {
    const ctx = assembleConsistencyContext(r);
    expect(ctx.task).toBe("consistency");
    expect(ctx.scopeKind).toBe("full");
    expect(ctx.coverageSummary.map((s) => s.specId).sort()).toEqual(
      ["fixture-alpha", "fixture-beta", "fixture-delta"].sort(),
    );
    expect(ctx.readinessSummary.length).toBe(3);
  });
});
