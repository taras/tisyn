// SS-RDY — checkCoverage + isReady per §5.8 of
// spec-system-test-plan.source.md and §11.3 of
// spec-system-specification.source.md.

import { describe, expect, test } from "vitest";
import {
  Ambiguity,
  Covers,
  DependsOn,
  Rule,
  Section,
  Spec,
  TestCase,
  TestCategory,
  TestPlan,
  TestPlanSection,
} from "./constructors.ts";
import { Resolution, Status, Strength, Tier } from "./enums.ts";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import { buildRegistry } from "./registry.ts";
import type {
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  SpecModule,
  TestPlanModule,
} from "./types.ts";
import { checkCoverage, isReady } from "./validate.ts";

function normSpec(m: SpecModule): NormalizedSpecModule {
  const r = normalizeSpec(m);
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}
function normPlan(m: TestPlanModule): NormalizedTestPlanModule {
  const r = normalizeTestPlan(m);
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}

function readySpec(): NormalizedSpecModule {
  return normSpec(
    Spec({
      id: "spec-a",
      title: "A",
      version: "0.1.0",
      status: Status.Active,
      sections: [Section({ id: "s1", title: "S", normative: true, prose: "." })],
      rules: [
        Rule({
          id: "A-R1",
          section: "s1",
          strength: Strength.MUST,
          statement: "r",
        }),
      ],
    }),
  );
}

function readyPlan(
  overrides: Partial<Parameters<typeof TestPlan>[0]> = {},
): NormalizedTestPlanModule {
  return normPlan(
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
              id: "PLAN-A-T1",
              tier: Tier.Core,
              rules: ["A-R1"],
              description: "d",
              setup: "s",
              expected: "e",
            }),
          ],
        }),
      ],
      coreTier: 1,
      extendedTier: 0,
      coverageMatrix: [Covers("A-R1", ["PLAN-A-T1"])],
      ...overrides,
    }),
  );
}

describe("SS-RDY", () => {
  test("SS-RDY-001 checkCoverage on ready corpus — no errors, no uncovered rules", () => {
    const registry = buildRegistry([readySpec()], [readyPlan()]);
    const report = checkCoverage(registry, "spec-a");
    expect(report.specId).toBe("spec-a");
    expect(report.errors).toHaveLength(0);
    expect(report.uncoveredRules).toEqual([]);
  });

  test("SS-RDY-002 checkCoverage on unknown spec returns error report", () => {
    const registry = buildRegistry([readySpec()], [readyPlan()]);
    const report = checkCoverage(registry, "nonexistent");
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test("SS-RDY-003 checkCoverage lists rules with no Core coverage as uncovered", () => {
    const spec = normSpec(
      Spec({
        id: "spec-a",
        title: "A",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "s1", title: "S", normative: true, prose: "." })],
        rules: [
          Rule({
            id: "A-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "r1",
          }),
          Rule({
            id: "A-R2",
            section: "s1",
            strength: Strength.MUST,
            statement: "r2",
          }),
        ],
      }),
    );
    // Plan only covers A-R1
    const registry = buildRegistry([spec], [readyPlan()]);
    const report = checkCoverage(registry, "spec-a");
    expect(report.uncoveredRules).toContain("A-R2");
  });

  test("SS-RDY-004 isReady returns true on a clean ready corpus", () => {
    const registry = buildRegistry([readySpec()], [readyPlan()]);
    expect(isReady(registry, "spec-a")).toBe(true);
  });

  test("SS-RDY-005 isReady false when spec status is not Active (V10-1)", () => {
    const spec = normSpec(
      Spec({
        id: "spec-a",
        title: "A",
        version: "0.1.0",
        status: Status.Draft,
        sections: [Section({ id: "s1", title: "S", normative: true, prose: "." })],
        rules: [
          Rule({
            id: "A-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "r",
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [readyPlan()]);
    expect(isReady(registry, "spec-a")).toBe(false);
  });

  test("SS-RDY-006 isReady false when no companion plan exists (V10-2)", () => {
    const registry = buildRegistry([readySpec()], []);
    expect(isReady(registry, "spec-a")).toBe(false);
  });

  test("SS-RDY-007 isReady false when checkCoverage has errors (V10-3)", () => {
    const spec = readySpec();
    // Plan references bogus rule → V3-3 error → checkCoverage.errors > 0
    const plan = normPlan(
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
                id: "PLAN-A-T1",
                tier: Tier.Core,
                rules: ["BOGUS-R"],
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
    );
    const registry = buildRegistry([spec], [plan]);
    expect(isReady(registry, "spec-a")).toBe(false);
  });

  test("SS-RDY-008 isReady false when plan has unresolved ambiguity (V10-4)", () => {
    const plan = readyPlan({
      ambiguitySurface: [
        Ambiguity({
          id: "AMB-1",
          specSection: "s1",
          description: "open question",
          resolution: Resolution.Unresolved,
        }),
      ],
    });
    const registry = buildRegistry([readySpec()], [plan]);
    expect(isReady(registry, "spec-a")).toBe(false);
  });

  test("SS-RDY-009 isReady ignores a draft companion plan", () => {
    // Draft plan is broken (unresolved ambiguity, no coverage), but the active
    // companion plan is clean — readiness evaluates against the active pair.
    const activePlan = readyPlan();
    const draftPlan = normPlan(
      TestPlan({
        id: "plan-draft",
        title: "Draft",
        version: "0.1.0",
        status: Status.Draft,
        testsSpec: DependsOn("spec-a", "0.1.0"),
        sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "dc",
            title: "DC",
            tests: [
              TestCase({
                id: "PLAN-DRAFT-T1",
                tier: Tier.Core,
                rules: ["A-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
        ambiguitySurface: [
          Ambiguity({
            id: "AMB-D1",
            specSection: "s1",
            description: "still open",
            resolution: Resolution.Unresolved,
          }),
        ],
      }),
    );
    const registry = buildRegistry([readySpec()], [activePlan, draftPlan]);
    expect(isReady(registry, "spec-a")).toBe(true);
  });

  test("SS-RDY-010 isReady evaluates only the first active companion plan", () => {
    // Two active plans: first is clean, second has unresolved ambiguity.
    // pickActiveCompanion returns the first in authored order → isReady true.
    const firstPlan = readyPlan();
    const secondPlan = normPlan(
      TestPlan({
        id: "plan-second",
        title: "Second",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("spec-a", "0.1.0"),
        sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "sc",
            title: "SC",
            tests: [
              TestCase({
                id: "PLAN-SECOND-T1",
                tier: Tier.Core,
                rules: ["A-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
        coverageMatrix: [Covers("A-R1", ["PLAN-SECOND-T1"])],
        ambiguitySurface: [
          Ambiguity({
            id: "AMB-S1",
            specSection: "s1",
            description: "open",
            resolution: Resolution.Unresolved,
          }),
        ],
      }),
    );
    const registry = buildRegistry([readySpec()], [firstPlan, secondPlan]);
    expect(isReady(registry, "spec-a")).toBe(true);
  });

  test("SS-RDY-011 isReady false when only companion plan is superseded", () => {
    const plan = readyPlan({ id: "plan-sup", status: Status.Superseded });
    const registry = buildRegistry([readySpec()], [plan]);
    expect(isReady(registry, "spec-a")).toBe(false);
  });

  test("SS-RDY-012 checkCoverage scoped to active plan when two plans target spec", () => {
    // One active plan fully covers A-R1; one superseded plan has empty coverage.
    // checkCoverage should see uncoveredRules = [] and errors = [] because it
    // picks the active plan.
    const activePlan = readyPlan();
    const supersededPlan = normPlan(
      TestPlan({
        id: "plan-sup",
        title: "Old",
        version: "0.1.0",
        status: Status.Superseded,
        testsSpec: DependsOn("spec-a", "0.1.0"),
        sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "oc",
            title: "OC",
            tests: [
              TestCase({
                id: "PLAN-SUP-T1",
                tier: Tier.Core,
                rules: ["A-R1"],
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
    );
    const registry = buildRegistry([readySpec()], [activePlan, supersededPlan]);
    const report = checkCoverage(registry, "spec-a");
    expect(report.errors).toEqual([]);
    expect(report.uncoveredRules).toEqual([]);
  });

  test("SS-RDY-013 checkCoverage stays coverage-scoped when no active companion", () => {
    // Only a superseded plan exists — checkCoverage must return empty errors
    // and list every rule as uncovered. isReady owns the V10-2 failure path.
    const plan = readyPlan({ id: "plan-sup", status: Status.Superseded });
    const registry = buildRegistry([readySpec()], [plan]);
    const report = checkCoverage(registry, "spec-a");
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.uncoveredRules).toEqual(["A-R1"]);
  });
});
