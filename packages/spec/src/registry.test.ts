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

  it("registry maps reject set/delete/clear (RI1)", () => {
    const r = buildTestRegistry([fixtureAlpha], [fixtureAlphaPlan]);
    const snapshotSize = r.specs.size;
    const snapshotRuleSize = r.ruleIndex.size;
    const setters: Array<() => void> = [
      () => (r.specs as unknown as Map<string, unknown>).set("x", {}),
      () => (r.specs as unknown as Map<string, unknown>).delete("fixture-alpha"),
      () => (r.specs as unknown as Map<string, unknown>).clear(),
      () => (r.plans as unknown as Map<string, unknown>).set("x", {}),
      () => (r.ruleIndex as unknown as Map<string, unknown>).set("X1", {}),
      () => (r.termIndex as unknown as Map<string, unknown>).set("x", {}),
      () => (r.conceptIndex as unknown as Map<string, unknown>).set("x", {}),
      () => (r.errorCodeIndex as unknown as Map<string, unknown>).set("x", {}),
      () => (r.openQuestionIndex as unknown as Map<string, unknown>).set("x", {}),
    ];
    for (const setter of setters) {
      expect(setter).toThrow(TypeError);
    }
    expect(r.specs.size).toBe(snapshotSize);
    expect(r.specs.has("fixture-alpha")).toBe(true);
    expect(r.ruleIndex.size).toBe(snapshotRuleSize);
  });

  it("rejects prototype-path mutation (RI1)", () => {
    // Own-property overrides on a live Map don't stop callers from going
    // through `Map.prototype.set.call(instance, ...)`. The registry's
    // `ImmutableMap` wrapper carries no `[[MapData]]` slot, so prototype
    // invocation throws `TypeError` with "incompatible receiver".
    const r = buildTestRegistry([fixtureAlpha], [fixtureAlphaPlan]);
    const snapshotSize = r.specs.size;
    const snapshotRuleSize = r.ruleIndex.size;

    const prototypeMutators: Array<() => void> = [
      () => Map.prototype.set.call(r.specs as unknown as Map<string, unknown>, "x", {}),
      () => Map.prototype.delete.call(r.specs as unknown as Map<string, unknown>, "fixture-alpha"),
      () => Map.prototype.clear.call(r.specs as unknown as Map<string, unknown>),
      () => Map.prototype.set.call(r.plans as unknown as Map<string, unknown>, "x", {}),
      () => Map.prototype.set.call(r.ruleIndex as unknown as Map<string, unknown>, "X1", {}),
      () => Map.prototype.set.call(r.termIndex as unknown as Map<string, unknown>, "x", {}),
      () => Map.prototype.set.call(r.conceptIndex as unknown as Map<string, unknown>, "x", {}),
      () => Map.prototype.set.call(r.errorCodeIndex as unknown as Map<string, unknown>, "x", {}),
      () =>
        Map.prototype.set.call(
          r.openQuestionIndex as unknown as Map<string, unknown>,
          "x",
          {},
        ),
    ];
    for (const mutate of prototypeMutators) {
      expect(mutate).toThrow(TypeError);
    }
    expect(r.specs.size).toBe(snapshotSize);
    expect(r.specs.has("fixture-alpha")).toBe(true);
    expect(r.ruleIndex.size).toBe(snapshotRuleSize);
  });
});

describe("SS-RG cross-module id collisions", () => {
  it("throws on duplicate spec ids at construction time (D2)", () => {
    expect(() => buildTestRegistry([fixtureAlpha, fixtureAlpha])).toThrow();
  });

  it("throws when a spec and a test-plan share an id (D2 + D18)", () => {
    const collidingPlan = { ...fixtureAlphaPlan, id: "fixture-alpha" };
    expect(() =>
      buildTestRegistry([fixtureAlpha], [collidingPlan]),
    ).toThrow(/duplicate id "fixture-alpha"/);
  });
});
