// SS-QA: analysis queries — coverage, readiness, term conflicts, stale refs,
// error-code collisions, duplicate rules.

import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  findDuplicateRules,
  findErrorCodeCollisions,
  findStaleReferences,
  findTermConflicts,
  isReady,
} from "./analysis.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureBetaConflictingTerm,
  fixtureDelta,
  fixtureGamma,
} from "../__fixtures__/index.ts";

describe("SS-QA coverage", () => {
  const r = buildTestRegistry([fixtureAlpha], [fixtureAlphaPlan]);

  it("checkCoverage partitions rules covered/uncovered", () => {
    const c = checkCoverage(r, "fixture-alpha");
    expect(c.coveredRules.map((r) => r.rule.id)).toEqual(["A1"]);
    expect(c.uncoveredRules.map((r) => r.rule.id)).toEqual(["A2"]);
    expect(c.stats).toEqual({ total: 2, covered: 1, uncovered: 1, deferred: 0 });
  });

  it("checkCoverage returns all-uncovered when companion plan absent", () => {
    const r2 = buildTestRegistry([fixtureBeta, fixtureAlpha], []);
    const c = checkCoverage(r2, "fixture-beta");
    expect(c.companionPlanId).toBeUndefined();
    expect(c.uncoveredRules.map((r) => r.rule.id)).toEqual(["B1"]);
  });
});

describe("SS-QA readiness", () => {
  it("isReady returns ready when must-rules covered and no blockers", () => {
    const r = buildTestRegistry([fixtureAlpha], [fixtureAlphaPlan]);
    const result = isReady(r, "fixture-alpha");
    expect(result.specId).toBe("fixture-alpha");
    expect(result.ready).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("isReady returns blocking=status-not-active for draft", () => {
    const r = buildTestRegistry([fixtureDelta, fixtureAlpha], []);
    const result = isReady(r, "fixture-delta");
    expect(result.ready).toBe(false);
    expect(result.blocking).toContain("status-not-active");
    expect(result.blocking).toContain("open-questions");
  });
});

describe("SS-QA term conflicts", () => {
  it("detects same term with different definitions across specs", () => {
    const r = buildTestRegistry(
      [fixtureAlpha, fixtureBetaConflictingTerm()],
      [],
    );
    const conflicts = findTermConflicts(r);
    expect(conflicts.map((c) => c.term)).toContain("Alpha");
  });
});

describe("SS-QA stale references", () => {
  it("flags missing-spec for unresolved relationship targets", () => {
    const r = buildTestRegistry([fixtureDelta, fixtureAlpha], []);
    const stale = findStaleReferences(r);
    expect(stale.some((s) => s.problem === "missing-spec" && s.referencedSpecId === "fixture-missing")).toBe(true);
  });

  it("flags superseded-spec when target is superseded", () => {
    const src = {
      ...fixtureDelta,
      relationships: [{ type: "depends-on" as const, target: "fixture-gamma" }],
    };
    const r = buildTestRegistry([src, fixtureAlpha, fixtureGamma], []);
    const stale = findStaleReferences(r);
    expect(stale.some((s) => s.problem === "superseded-spec")).toBe(true);
  });
});

describe("SS-QA duplicate rules + error codes", () => {
  it("findDuplicateRules returns [] when none collide", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBeta], []);
    expect(findDuplicateRules(r)).toEqual([]);
  });

  it("findErrorCodeCollisions returns [] when none exist", () => {
    const r = buildTestRegistry([fixtureAlpha], []);
    expect(findErrorCodeCollisions(r)).toEqual([]);
  });
});
