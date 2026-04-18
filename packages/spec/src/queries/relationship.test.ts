// SS-QR: relationship queries (impact, transitive, dependencyOrder, cycles).

import { describe, expect, it } from "vitest";
import { dependencyOrder, hasCycles, impactOf, transitiveDependencies } from "./relationship.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureDelta,
  fixtureEpsilonCycle,
} from "../__fixtures__/index.ts";

describe("SS-QR relationship", () => {
  const r = buildTestRegistry([fixtureAlpha, fixtureBeta, fixtureDelta], [fixtureAlphaPlan]);

  it("dependencyOrder returns registry order", () => {
    expect(dependencyOrder(r)).toEqual(r.dependencyOrder);
    expect(dependencyOrder(r)[0]).toBe("fixture-alpha");
  });

  it("impactOf surfaces direct depends-on dependents", () => {
    const impacts = impactOf(r, "fixture-alpha");
    const sources = impacts.map((i) => i.specId);
    expect(sources).toContain("fixture-beta");
    expect(sources).toContain("fixture-delta");
  });

  it("impactOf includes test-plan references", () => {
    const impacts = impactOf(r, "fixture-alpha");
    const testRefs = impacts.filter((i) => i.impactType === "test-references");
    expect(testRefs.map((t) => t.specId)).toContain("fixture-alpha-plan");
  });

  it("impactOf detects prose §-references across specs", () => {
    const impacts = impactOf(r, "fixture-alpha", 2);
    const prose = impacts.filter((i) => i.impactType === "prose-references");
    expect(prose.map((p) => p.specId)).toContain("fixture-delta");
  });

  it("transitiveDependencies follows depends-on + amends", () => {
    expect(transitiveDependencies(r, "fixture-beta")).toEqual(["fixture-alpha"]);
  });

  it("hasCycles is false for acyclic graphs", () => {
    expect(hasCycles(r)).toBe(false);
  });

  it("hasCycles is true when there is a cycle", () => {
    const [a, b] = fixtureEpsilonCycle();
    const cyc = buildTestRegistry([a, b], []);
    expect(hasCycles(cyc)).toBe(true);
  });
});
