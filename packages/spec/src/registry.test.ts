// SS-RG: registry indices, precedence, edges, dependencyOrder, topo-on-cycle,
// scope filter enforcement, immutability.

import { describe, expect, it } from "vitest";
import { buildTestRegistry } from "./__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureBetaConflictingTerm,
  fixtureDelta,
  fixtureEpsilonCycle,
} from "./__fixtures__/index.ts";

describe("SS-RG indices", () => {
  it("populates ruleIndex with every rule from every in-scope spec", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBeta]);
    expect(r.ruleIndex.has("A1")).toBe(true);
    expect(r.ruleIndex.has("A2")).toBe(true);
    expect(r.ruleIndex.has("B1")).toBe(true);
  });

  it("populates termIndex keyed by term string", () => {
    const r = buildTestRegistry([fixtureAlpha]);
    expect(r.termIndex.has("Alpha")).toBe(true);
  });

  it("populates openQuestionIndex from specs with open questions", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureDelta]);
    expect(r.openQuestionIndex.has("OQ-D-1")).toBe(true);
  });
});

describe("SS-RG dependencyOrder", () => {
  it("emits in-scope specs in topological order over depends-on", () => {
    const r = buildTestRegistry([fixtureBeta, fixtureAlpha]);
    const ai = r.dependencyOrder.indexOf("fixture-alpha");
    const bi = r.dependencyOrder.indexOf("fixture-beta");
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(bi).toBeGreaterThan(ai);
  });

  it("produces best-effort partial order on cycles (R6)", () => {
    const [a, b] = fixtureEpsilonCycle();
    const r = buildTestRegistry([a, b]);
    expect(r.dependencyOrder.length).toBe(2);
    expect([...r.dependencyOrder].sort()).toEqual([
      "fixture-epsilon-a",
      "fixture-epsilon-b",
    ]);
  });
});

describe("SS-RG precedence (R3/R4)", () => {
  it("earlier in dependencyOrder wins on term-index key collision", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBetaConflictingTerm()]);
    const loc = r.termIndex.get("Alpha");
    expect(loc).toBeDefined();
    expect(loc!.specId).toBe("fixture-alpha");
  });
});

describe("SS-RG edges", () => {
  it("emits one RelationshipEdge per in-scope relationship", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBeta]);
    const edge = r.edges.find(
      (e) => e.source === "fixture-beta" && e.target === "fixture-alpha",
    );
    expect(edge).toBeDefined();
    expect(edge!.type).toBe("depends-on");
  });

  it("retains edges whose target is out-of-scope (unresolved)", () => {
    const r = buildTestRegistry([fixtureDelta]);
    const unresolved = r.edges.find((e) => e.target === "fixture-missing");
    expect(unresolved).toBeDefined();
  });
});

describe("SS-RG scope filter", () => {
  it("filtered scope drops out-of-scope specs silently", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBeta], [], {
      kind: "filtered",
      specIds: ["fixture-beta"],
    });
    expect(r.specs.has("fixture-beta")).toBe(true);
    expect(r.specs.has("fixture-alpha")).toBe(false);
  });

  it("preserves scope verbatim on the registry (R7/I9)", () => {
    const r = buildTestRegistry([fixtureAlpha], [], {
      kind: "filtered",
      specIds: ["fixture-alpha"],
    });
    expect(r.scope).toEqual({ kind: "filtered", specIds: ["fixture-alpha"] });
  });

  it("pulls companion plans in automatically under filtered scope", () => {
    const r = buildTestRegistry(
      [fixtureAlpha, fixtureBeta],
      [fixtureAlphaPlan],
      { kind: "filtered", specIds: ["fixture-alpha"] },
    );
    expect(r.plans.has("fixture-alpha-plan")).toBe(true);
  });
});

describe("SS-RG immutability", () => {
  it("registry and its arrays are frozen", () => {
    const r = buildTestRegistry([fixtureAlpha]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.edges)).toBe(true);
    expect(Object.isFrozen(r.dependencyOrder)).toBe(true);
  });
});

describe("SS-RG cross-module id collisions", () => {
  it("throws on duplicate spec ids at construction time (D2)", () => {
    expect(() => buildTestRegistry([fixtureAlpha, fixtureAlpha])).toThrow();
  });
});
