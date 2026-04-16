// SS-REG — Registry construction tests per §5.6 of
// spec-system-test-plan.source.md.

import { describe, expect, test } from "vitest";
import {
  Concept,
  DependsOn,
  ErrorCode,
  Invariant,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  TestPlanSection,
} from "./constructors.ts";
import { Status, Strength, Tier } from "./enums.ts";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import { buildRegistry } from "./registry.ts";
import type { NormalizedSpecModule, NormalizedTestPlanModule } from "./types.ts";

function unwrap<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) {
    throw new Error("expected ok");
  }
  return r.value;
}

function specA(): NormalizedSpecModule {
  return unwrap(
    normalizeSpec(
      Spec({
        id: "spec-a",
        title: "A",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "s1", title: "S1", normative: true, prose: "." })],
        rules: [
          Rule({
            id: "X-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "a",
          }),
          Rule({
            id: "X-R2",
            section: "s1",
            strength: Strength.SHOULD,
            statement: "b",
          }),
        ],
        invariants: [Invariant({ id: "X-I1", section: "s1", statement: "inv" })],
        errorCodes: [ErrorCode({ code: "E-TEST-001", section: "s1", trigger: "t" })],
        concepts: [
          Concept({
            name: "spawn-handle",
            section: "s1",
            description: "desc",
          }),
        ],
        terms: [
          Term({
            term: "compound-external",
            section: "s1",
            definition: "def",
          }),
        ],
      }),
    ),
  );
}

function specB(): NormalizedSpecModule {
  return unwrap(
    normalizeSpec(
      Spec({
        id: "spec-b",
        title: "B",
        version: "0.1.0",
        status: Status.Active,
        dependsOn: [DependsOn("spec-a", "0.1.0")],
        sections: [Section({ id: "sb", title: "SB", normative: true, prose: "." })],
      }),
    ),
  );
}

function planForA(): NormalizedTestPlanModule {
  return unwrap(
    normalizeTestPlan(
      TestPlan({
        id: "plan-a",
        title: "Plan A",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("spec-a", "0.1.0"),
        sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "X-T1",
                tier: Tier.Core,
                rules: ["X-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
      }),
    ),
  );
}

function planForB(): NormalizedTestPlanModule {
  return unwrap(
    normalizeTestPlan(
      TestPlan({
        id: "plan-b",
        title: "Plan B",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("spec-b", "0.1.0"),
        sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "B-T1",
                tier: Tier.Core,
                rules: ["B-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
      }),
    ),
  );
}

describe("SS-REG", () => {
  test("SS-REG-001 buildRegistry accepts normalized modules (R1)", () => {
    const registry = buildRegistry([specA()], [planForA()]);
    expect(registry).toBeDefined();
    expect(registry.specs).toBeInstanceOf(Map);
    expect(registry.testPlans).toBeInstanceOf(Map);
  });

  test("SS-REG-002 Registry requires only normalized artifacts (R2, LB3)", () => {
    const source = specA();
    const plan = planForA();
    const fromSource = buildRegistry([source], [plan]);
    const fromJson = buildRegistry(
      [JSON.parse(JSON.stringify(source)) as NormalizedSpecModule],
      [JSON.parse(JSON.stringify(plan)) as NormalizedTestPlanModule],
    );
    expect(fromJson.specs.get("spec-a")).toEqual(fromSource.specs.get("spec-a"));
    expect(fromJson.ruleIndex.get("X-R1")).toEqual(fromSource.ruleIndex.get("X-R1"));
  });

  test("SS-REG-003 specs map indexes by id (R3)", () => {
    const registry = buildRegistry([specA(), specB()], []);
    expect(registry.specs.get("spec-a")?.id).toBe("spec-a");
    expect(registry.specs.get("spec-b")?.id).toBe("spec-b");
    expect(registry.specs.get("nope")).toBeUndefined();
  });

  test("SS-REG-004 testPlans map indexes by id (R4)", () => {
    const registry = buildRegistry([specA(), specB()], [planForA(), planForB()]);
    expect(registry.testPlans.get("plan-a")?.id).toBe("plan-a");
    expect(registry.testPlans.get("plan-b")?.id).toBe("plan-b");
  });

  test("SS-REG-005 ruleIndex maps rule IDs to locations (R5, D40)", () => {
    const registry = buildRegistry([specA()], []);
    expect(registry.ruleIndex.get("X-R1")).toEqual({
      specId: "spec-a",
      section: "s1",
      strength: Strength.MUST,
    });
    expect(registry.ruleIndex.get("X-R2")).toEqual({
      specId: "spec-a",
      section: "s1",
      strength: Strength.SHOULD,
    });
  });

  test("SS-REG-006 ruleIndex includes invariant IDs (R5)", () => {
    const registry = buildRegistry([specA()], []);
    const loc = registry.ruleIndex.get("X-I1");
    expect(loc).toBeDefined();
    expect(loc?.specId).toBe("spec-a");
    expect(loc?.section).toBe("s1");
  });

  test("SS-REG-007 errorCodeIndex maps codes to locations (R6, D41)", () => {
    const registry = buildRegistry([specA()], []);
    expect(registry.errorCodeIndex.get("E-TEST-001")).toEqual({
      specId: "spec-a",
      section: "s1",
      trigger: "t",
    });
  });

  test("SS-REG-008 termAuthority maps term → defining spec id (R7)", () => {
    const registry = buildRegistry([specA()], []);
    expect(registry.termAuthority.get("compound-external")).toBe("spec-a");
  });

  test("SS-REG-009 conceptIndex maps concepts to locations (R8, D42)", () => {
    const registry = buildRegistry([specA()], []);
    expect(registry.conceptIndex.get("spawn-handle")).toEqual({
      specId: "spec-a",
      section: "s1",
      description: "desc",
    });
  });

  test("SS-REG-010 Registry is not persisted (R13)", () => {
    const source = specA();
    const plan = planForA();
    const first = buildRegistry([source], [plan]);
    const second = buildRegistry([source], [plan]);
    expect(first).not.toBe(second);
    expect(first.specs).not.toBe(second.specs);
    expect(first.specs.get("spec-a")).toEqual(second.specs.get("spec-a"));
  });
});
