// SS-QP: projection queries — discovery pack (typed, not string),
// constraint document, task context (runtime-validated inputs).

import { describe, expect, it } from "vitest";
import {
  generateConstraintDocument,
  generateDiscoveryPack,
  generateTaskContext,
} from "./projection.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureDelta,
} from "../__fixtures__/index.ts";

describe("SS-QP discovery pack", () => {
  const r = buildTestRegistry(
    [fixtureAlpha, fixtureBeta, fixtureDelta],
    [fixtureAlphaPlan],
  );

  it("returns a typed object, not a string (SS-QP-001)", () => {
    const pack = generateDiscoveryPack(r, { now: () => "2026-01-01T00:00:00Z" });
    expect(typeof pack).toBe("object");
    expect(pack.scopeKind).toBe("full");
    expect(pack.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(pack.specCount).toBe(3);
    expect(pack.specs.map((s) => s.id)).toContain("fixture-alpha");
  });

  it("records consistency summary counts", () => {
    const pack = generateDiscoveryPack(r);
    expect(pack.consistency.cycles).toBe(false);
    expect(pack.consistency.staleReferences).toBeGreaterThanOrEqual(1);
  });
});

describe("SS-QP constraint document", () => {
  const r = buildTestRegistry([fixtureAlpha, fixtureBeta], [fixtureAlphaPlan]);

  it("constraintDocument carries target-specific info", () => {
    const cd = generateConstraintDocument(r, "fixture-alpha");
    expect(cd.targetSpecId).toBe("fixture-alpha");
    expect(cd.targetTitle).toBe("Fixture Alpha");
    expect(cd.definedTerms.map((t) => t.term)).toContain("Alpha");
    expect(cd.downstreamDependents.map((d) => d.specId)).toContain("fixture-beta");
  });
});

describe("SS-QP task context", () => {
  const r = buildTestRegistry([fixtureAlpha, fixtureBeta], [fixtureAlphaPlan]);

  it("throws when none of specIds/rulePattern/termPattern provided (SS-QP-007)", () => {
    expect(() => generateTaskContext(r, {})).toThrow();
  });

  it("returns matchingRules for rulePattern", () => {
    const tc = generateTaskContext(r, { rulePattern: "Alpha" });
    expect(tc.scopeKind).toBe("full");
    expect(tc.matchingRules.length).toBeGreaterThanOrEqual(1);
    expect(typeof tc.tokenEstimate).toBe("number");
  });

  it("expands via relationships when includeRelated", () => {
    const tc = generateTaskContext(r, {
      specIds: ["fixture-beta"],
      includeRelated: true,
    });
    expect(tc.relevantSpecs.map((s) => s.id)).toContain("fixture-alpha");
  });
});
