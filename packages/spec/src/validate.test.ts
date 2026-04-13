// SS-V1..V9 — validateCorpus and per-rule helpers per §5.7 of
// spec-system-test-plan.source.md. Each per-rule helper is imported from the
// same package but is NOT part of the public surface (§11.3) — tests call
// them directly to keep check isolation without widening `index.ts`.

import { describe, expect, test } from "vitest";
import {
  Ambiguity,
  Amendment,
  Amends,
  ChangedSection,
  Complements,
  Concept,
  Covers,
  DependsOn,
  ErrorCode,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  UnchangedSection,
} from "./constructors.ts";
import { ChangeType, Resolution, Status, Strength, Tier } from "./enums.ts";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import { buildRegistry, getInternalGraphs } from "./registry.ts";
import type {
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  SpecModule,
  TestPlanModule,
} from "./types.ts";
import {
  validateCorpus,
  validateV1_Identity,
  validateV2_Linkage,
  validateV3_Coverage,
  validateV4_Amendments,
  validateV5_ChangedUnchanged,
  validateV6_Graphs,
  validateV7_Terms,
  validateV8_Stale,
  validateV9_ErrorCodes,
} from "./validate.ts";

function normSpec(module: SpecModule): NormalizedSpecModule {
  const r = normalizeSpec(module);
  if (!r.ok) {
    throw new Error(`expected ok spec: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}

function normPlan(module: TestPlanModule): NormalizedTestPlanModule {
  const r = normalizeTestPlan(module);
  if (!r.ok) {
    throw new Error(`expected ok plan: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}

function minimalSpec(id: string, overrides: Partial<Parameters<typeof Spec>[0]> = {}): SpecModule {
  return Spec({
    id,
    title: id,
    version: "0.1.0",
    status: Status.Active,
    sections: [Section({ id: "s1", title: "S1", normative: true, prose: "." })],
    rules: [
      Rule({
        id: `${id.toUpperCase()}-R1`,
        section: "s1",
        strength: Strength.MUST,
        statement: "r1",
      }),
    ],
    ...overrides,
  });
}

function minimalPlan(
  id: string,
  targetId: string,
  overrides: Partial<Parameters<typeof TestPlan>[0]> = {},
): TestPlanModule {
  const testId = `${id.toUpperCase()}-T1`;
  return TestPlan({
    id,
    title: id,
    version: "0.1.0",
    status: Status.Active,
    testsSpec: DependsOn(targetId, "0.1.0"),
    categories: [
      TestCategory({
        id: "c1",
        title: "C1",
        tests: [
          TestCase({
            id: testId,
            tier: Tier.Core,
            rules: [`${targetId.toUpperCase()}-R1`],
            description: "d",
            setup: "s",
            expected: "e",
          }),
        ],
      }),
    ],
    coreTier: 1,
    extendedTier: 0,
    coverageMatrix: [Covers(`${targetId.toUpperCase()}-R1`, [testId])],
    ...overrides,
  });
}

// ── SS-V1 — Identity and Uniqueness ──

describe("SS-V1 validateV1_Identity", () => {
  test("SS-V1-001 clean corpus emits no V1 findings", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const registry = buildRegistry([spec], []);
    const { errors, warnings } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("SS-V1-002 V1-1 empty spec id — structurally blocked (precondition)", () => {
    // normalizeSpec rejects empty ids structurally, so V1-1 is a
    // post-structural safety net. The check still fires if a caller bypasses
    // normalization and hand-constructs a NormalizedSpecModule with "".
    const good = normSpec(minimalSpec("spec-a"));
    const bad = { ...good, id: "" } as NormalizedSpecModule;
    const registry = buildRegistry([bad], []);
    const { errors } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V1-1")).toBe(true);
  });

  test("SS-V1-003 V1-2 empty test plan id is flagged", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(minimalPlan("plan-a", "spec-a"));
    const badPlan = { ...plan, id: "" } as NormalizedTestPlanModule;
    const registry = buildRegistry([spec], [badPlan]);
    const { errors } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V1-2")).toBe(true);
  });

  test("SS-V1-004 V1-3 duplicate spec ids tracked via InternalGraphs", () => {
    const a1 = normSpec(minimalSpec("spec-a"));
    const a2 = normSpec(minimalSpec("spec-a"));
    const registry = buildRegistry([a1, a2], []);
    const graphs = getInternalGraphs(registry);
    expect(graphs.duplicateSpecIds).toContain("spec-a");
    const { errors } = validateV1_Identity(registry, graphs);
    expect(errors.some((e) => e.check === "V1-3")).toBe(true);
  });

  test("SS-V1-005 V1-4 duplicate test plan ids are flagged", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const p1 = normPlan(minimalPlan("plan-a", "spec-a"));
    const p2 = normPlan(
      minimalPlan("plan-a", "spec-a", {
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "OTHER-T1",
                tier: Tier.Core,
                rules: ["SPEC-A-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [p1, p2]);
    const { errors } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V1-4")).toBe(true);
  });

  test("SS-V1-006 V1-5 duplicate rule ids across specs are flagged", () => {
    const a = normSpec(minimalSpec("spec-a"));
    const b = normSpec(
      minimalSpec("spec-b", {
        rules: [
          Rule({
            id: "SPEC-A-R1", // collide with spec-a's rule id
            section: "s1",
            strength: Strength.MUST,
            statement: "x",
          }),
        ],
      }),
    );
    const registry = buildRegistry([a, b], []);
    const { errors } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V1-5")).toBe(true);
  });

  test("SS-V1-007 V1-6 duplicate error codes across specs are flagged", () => {
    const a = normSpec(
      minimalSpec("spec-a", {
        errorCodes: [ErrorCode({ code: "E-DUP", section: "s1", trigger: "t" })],
      }),
    );
    const b = normSpec(
      minimalSpec("spec-b", {
        errorCodes: [ErrorCode({ code: "E-DUP", section: "s1", trigger: "t" })],
      }),
    );
    const registry = buildRegistry([a, b], []);
    const { errors } = validateV1_Identity(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V1-6")).toBe(true);
  });
});

// ── SS-V2 — Spec/Test-Plan Linkage ──

describe("SS-V2 validateV2_Linkage", () => {
  test("SS-V2-001 V2-1 test plan targets nonexistent spec → error", () => {
    const plan = normPlan(minimalPlan("plan-a", "spec-missing"));
    const registry = buildRegistry([], [plan]);
    const { errors } = validateV2_Linkage(registry);
    expect(errors.some((e) => e.check === "V2-1")).toBe(true);
  });

  test("SS-V2-002 V2-2 testsSpec version mismatch → warning", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        testsSpec: DependsOn("spec-a", "9.9.9"),
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { warnings } = validateV2_Linkage(registry);
    expect(warnings.some((w) => w.check === "V2-2")).toBe(true);
  });

  test("SS-V2-003 V2-3 active spec without companion test plan → warning", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const registry = buildRegistry([spec], []);
    const { warnings } = validateV2_Linkage(registry);
    expect(warnings.some((w) => w.check === "V2-3")).toBe(true);
  });
});

// ── SS-V3 — Rule Coverage ──

describe("SS-V3 validateV3_Coverage", () => {
  test("SS-V3-001 V3-1 coverage entry references rule not in target spec", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        coverageMatrix: [Covers("BOGUS-R1", ["PLAN-A-T1"])],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { errors } = validateV3_Coverage(registry);
    expect(errors.some((e) => e.check === "V3-1")).toBe(true);
  });

  test("SS-V3-002 V3-2 coverage entry references test id not in plan", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        coverageMatrix: [Covers("SPEC-A-R1", ["BOGUS-T99"])],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { errors } = validateV3_Coverage(registry);
    expect(errors.some((e) => e.check === "V3-2")).toBe(true);
  });

  test("SS-V3-003 V3-3 TestCase.rules references unknown rule", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "PLAN-A-T1",
                tier: Tier.Core,
                rules: ["NOT-A-REAL-RULE"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { errors } = validateV3_Coverage(registry);
    expect(errors.some((e) => e.check === "V3-3")).toBe(true);
  });

  test("SS-V3-004 V3-4 normative rule with no coverage entry → warning", () => {
    const spec = normSpec(
      minimalSpec("spec-a", {
        rules: [
          Rule({
            id: "SPEC-A-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "r1",
          }),
          Rule({
            id: "SPEC-A-R2",
            section: "s1",
            strength: Strength.MUST,
            statement: "r2",
          }),
        ],
      }),
    );
    // Plan only covers R1 (default minimalPlan)
    const plan = normPlan(minimalPlan("plan-a", "spec-a"));
    const registry = buildRegistry([spec], [plan]);
    const { warnings } = validateV3_Coverage(registry);
    expect(warnings.some((w) => w.check === "V3-4" && w.ruleId === "SPEC-A-R2")).toBe(true);
  });

  test("SS-V3-005 V3-5 rule with only Extended coverage → warning", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "PLAN-A-T1",
                tier: Tier.Extended,
                rules: ["SPEC-A-R1"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
        coreTier: 0,
        extendedTier: 1,
        coverageMatrix: [Covers("SPEC-A-R1", ["PLAN-A-T1"])],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { warnings } = validateV3_Coverage(registry);
    expect(warnings.some((w) => w.check === "V3-5")).toBe(true);
  });

  test("SS-V3-006 V3-6 tier counts mismatch declared → warning", () => {
    // Structural validation blocks this at normalize time; synthesize the
    // bad plan directly to exercise V3-6.
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(minimalPlan("plan-a", "spec-a"));
    const wrongPlan = { ...plan, coreTier: 99 } as NormalizedTestPlanModule;
    const registry = buildRegistry([spec], [wrongPlan]);
    const { warnings } = validateV3_Coverage(registry);
    expect(warnings.some((w) => w.check === "V3-6")).toBe(true);
  });
});

// ── SS-V4 — Amendment Integrity ──

describe("SS-V4 validateV4_Amendments", () => {
  test("SS-V4-001 V4-1 amends nonexistent spec → error", () => {
    const spec = normSpec(
      minimalSpec("spec-a", {
        amends: [Amends("nonexistent")],
      }),
    );
    const registry = buildRegistry([spec], []);
    const { errors } = validateV4_Amendments(registry);
    expect(errors.some((e) => e.check === "V4-1")).toBe(true);
  });

  test("SS-V4-002 V4-2 amends references unknown section in target → error", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base", "0.1.0", ["nonexistent-section"])],
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { errors } = validateV4_Amendments(registry);
    expect(errors.some((e) => e.check === "V4-2")).toBe(true);
  });

  test("SS-V4-003 V4-3 amends present but no amendment detail → warning", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base")],
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { warnings } = validateV4_Amendments(registry);
    expect(warnings.some((w) => w.check === "V4-3")).toBe(true);
  });
});

// ── SS-V5 — Changed/Unchanged integrity ──

describe("SS-V5 validateV5_ChangedUnchanged", () => {
  test("SS-V5-001 V5-1 changedSection refers to nonexistent target section", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base")],
        amendment: Amendment({
          changedSections: [
            ChangedSection({
              targetSpec: "spec-base",
              section: "bogus-section",
              changeType: ChangeType.Modified,
            }),
          ],
          unchangedSections: [UnchangedSection({ targetSpec: "spec-base", section: "s1" })],
          preservedBehavior: [],
          newBehavior: [],
        }),
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { errors } = validateV5_ChangedUnchanged(registry);
    expect(errors.some((e) => e.check === "V5-1")).toBe(true);
  });

  test("SS-V5-002 V5-2 unchangedSection refers to nonexistent target section", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base")],
        amendment: Amendment({
          changedSections: [],
          unchangedSections: [
            UnchangedSection({
              targetSpec: "spec-base",
              section: "bogus-section",
            }),
          ],
          preservedBehavior: [],
          newBehavior: [],
        }),
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { errors } = validateV5_ChangedUnchanged(registry);
    expect(errors.some((e) => e.check === "V5-2")).toBe(true);
  });

  test("SS-V5-003 V5-3 section listed as both changed and unchanged → error", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base")],
        amendment: Amendment({
          changedSections: [
            ChangedSection({
              targetSpec: "spec-base",
              section: "s1",
              changeType: ChangeType.Modified,
            }),
          ],
          unchangedSections: [UnchangedSection({ targetSpec: "spec-base", section: "s1" })],
          preservedBehavior: [],
          newBehavior: [],
        }),
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { errors } = validateV5_ChangedUnchanged(registry);
    expect(errors.some((e) => e.check === "V5-3")).toBe(true);
  });

  test("SS-V5-004 V5-4 amendment omits some target sections → warning", () => {
    const base = normSpec(
      minimalSpec("spec-base", {
        sections: [
          Section({ id: "s1", title: "S1", normative: true, prose: "." }),
          Section({ id: "s2", title: "S2", normative: true, prose: "." }),
        ],
      }),
    );
    const amender = normSpec(
      minimalSpec("spec-amender", {
        amends: [Amends("spec-base")],
        amendment: Amendment({
          changedSections: [
            ChangedSection({
              targetSpec: "spec-base",
              section: "s1",
              changeType: ChangeType.Modified,
            }),
          ],
          unchangedSections: [],
          preservedBehavior: [],
          newBehavior: [],
        }),
      }),
    );
    const registry = buildRegistry([base, amender], []);
    const { warnings } = validateV5_ChangedUnchanged(registry);
    expect(warnings.some((w) => w.check === "V5-4" && w.sectionId === "s2")).toBe(true);
  });
});

// ── SS-V6 — Dependency and Reference Integrity ──

describe("SS-V6 validateV6_Graphs", () => {
  test("SS-V6-001 V6-1 dependsOn references nonexistent spec → error", () => {
    const spec = normSpec(minimalSpec("spec-a", { dependsOn: [DependsOn("spec-ghost")] }));
    const registry = buildRegistry([spec], []);
    const { errors } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V6-1")).toBe(true);
  });

  test("SS-V6-002 V6-2 complements references nonexistent spec → error", () => {
    const spec = normSpec(minimalSpec("spec-a", { complements: [Complements("spec-ghost")] }));
    const registry = buildRegistry([spec], []);
    const { errors } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V6-2")).toBe(true);
  });

  test("SS-V6-003 V6-3 dependency cycle detected", () => {
    const a = normSpec(minimalSpec("spec-a", { dependsOn: [DependsOn("spec-b")] }));
    const b = normSpec(minimalSpec("spec-b", { dependsOn: [DependsOn("spec-a")] }));
    const registry = buildRegistry([a, b], []);
    const { errors } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V6-3")).toBe(true);
  });

  test("SS-V6-004 V6-4 amendment cycle detected", () => {
    const a = normSpec(minimalSpec("spec-a", { amends: [Amends("spec-b")] }));
    const b = normSpec(minimalSpec("spec-b", { amends: [Amends("spec-a")] }));
    const registry = buildRegistry([a, b], []);
    const { errors } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V6-4")).toBe(true);
  });

  test("SS-V6-005 V6-5 dependsOn on superseded spec → warning", () => {
    const old = normSpec(minimalSpec("spec-old", { status: Status.Superseded }));
    const a = normSpec(minimalSpec("spec-a", { dependsOn: [DependsOn("spec-old")] }));
    const registry = buildRegistry([old, a], []);
    const { warnings } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(warnings.some((w) => w.check === "V6-5")).toBe(true);
  });

  test("SS-V6-006 clean DAG emits no V6 findings", () => {
    const base = normSpec(minimalSpec("spec-base"));
    const dep = normSpec(minimalSpec("spec-dep", { dependsOn: [DependsOn("spec-base")] }));
    const registry = buildRegistry([base, dep], []);
    const { errors, warnings } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("SS-V6-007 self-loop in dependency graph counted as cycle", () => {
    const a = normSpec(minimalSpec("spec-a", { dependsOn: [DependsOn("spec-a")] }));
    const registry = buildRegistry([a], []);
    const { errors } = validateV6_Graphs(registry, getInternalGraphs(registry));
    expect(errors.some((e) => e.check === "V6-3")).toBe(true);
  });
});

// ── SS-V7 — Term Authority and Concept Conflicts ──

describe("SS-V7 validateV7_Terms", () => {
  test("SS-V7-001 V7-1 duplicate term definition across specs → warning", () => {
    const a = normSpec(
      minimalSpec("spec-a", {
        terms: [Term({ term: "shared-term", section: "s1", definition: "d1" })],
      }),
    );
    const b = normSpec(
      minimalSpec("spec-b", {
        terms: [Term({ term: "shared-term", section: "s1", definition: "d2" })],
      }),
    );
    const registry = buildRegistry([a, b], []);
    const { warnings } = validateV7_Terms(registry);
    expect(warnings.some((w) => w.check === "V7-1")).toBe(true);
  });

  test("SS-V7-002 V7-2 conflicting concept descriptions → warning", () => {
    const a = normSpec(
      minimalSpec("spec-a", {
        concepts: [Concept({ name: "c", section: "s1", description: "first" })],
      }),
    );
    const b = normSpec(
      minimalSpec("spec-b", {
        concepts: [Concept({ name: "c", section: "s1", description: "second" })],
      }),
    );
    const registry = buildRegistry([a, b], []);
    const { warnings } = validateV7_Terms(registry);
    expect(warnings.some((w) => w.check === "V7-2")).toBe(true);
  });
});

// ── SS-V8 — Stale References ──

describe("SS-V8 validateV8_Stale", () => {
  test("SS-V8-001 V8-1 test references removed rule → error", () => {
    // spec-a has rule SPEC-A-R1; plan references SPEC-A-RGONE.
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "PLAN-A-T1",
                tier: Tier.Core,
                rules: ["SPEC-A-RGONE"],
                description: "d",
                setup: "s",
                expected: "e",
              }),
            ],
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { errors } = validateV8_Stale(registry);
    expect(errors.some((e) => e.check === "V8-1")).toBe(true);
  });

  test("SS-V8-002 V8-2 ambiguity references unknown section → warning", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        ambiguitySurface: [
          Ambiguity({
            id: "AMB-1",
            specSection: "bogus",
            description: "d",
            resolution: Resolution.Unresolved,
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { warnings } = validateV8_Stale(registry);
    expect(warnings.some((w) => w.check === "V8-2")).toBe(true);
  });

  test("SS-V8-003 V8-3 resolvedIn not version-shaped → warning", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    const plan = normPlan(
      minimalPlan("plan-a", "spec-a", {
        ambiguitySurface: [
          Ambiguity({
            id: "AMB-1",
            specSection: "s1",
            description: "d",
            resolution: Resolution.Resolved,
            resolvedIn: "not-a-version",
          }),
        ],
      }),
    );
    const registry = buildRegistry([spec], [plan]);
    const { warnings } = validateV8_Stale(registry);
    expect(warnings.some((w) => w.check === "V8-3")).toBe(true);
  });
});

// ── SS-V9 — Error-Code Traceability Integrity ──

describe("SS-V9 validateV9_ErrorCodes", () => {
  test("SS-V9-001 V9-1 empty trigger is defensively flagged", () => {
    // Structural validation blocks this at normalize time; hand-forge the
    // NormalizedSpecModule to exercise V9-1.
    const good = normSpec(
      minimalSpec("spec-a", {
        errorCodes: [ErrorCode({ code: "E-1", section: "s1", trigger: "x" })],
      }),
    );
    const bad = {
      ...good,
      errorCodes: [{ ...good.errorCodes[0]!, trigger: "" }],
    } as NormalizedSpecModule;
    const registry = buildRegistry([bad], []);
    const { warnings } = validateV9_ErrorCodes(registry);
    expect(warnings.some((w) => w.check === "V9-1")).toBe(true);
  });

  test("SS-V9-002 V9-2 empty requiredContent is defensively flagged", () => {
    const good = normSpec(
      minimalSpec("spec-a", {
        errorCodes: [
          ErrorCode({
            code: "E-1",
            section: "s1",
            trigger: "x",
            requiredContent: ["must include name"],
          }),
        ],
      }),
    );
    const bad = {
      ...good,
      errorCodes: [{ ...good.errorCodes[0]!, requiredContent: [] }],
    } as NormalizedSpecModule;
    const registry = buildRegistry([bad], []);
    const { warnings } = validateV9_ErrorCodes(registry);
    expect(warnings.some((w) => w.check === "V9-2")).toBe(true);
  });

  test("SS-V9-003 V9-3 error code collides with rule id in same spec → error", () => {
    const spec = normSpec(
      minimalSpec("spec-a", {
        rules: [
          Rule({
            id: "SPEC-A-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "r1",
          }),
        ],
        errorCodes: [ErrorCode({ code: "SPEC-A-R1", section: "s1", trigger: "t" })],
      }),
    );
    const registry = buildRegistry([spec], []);
    const { errors } = validateV9_ErrorCodes(registry);
    expect(errors.some((e) => e.check === "V9-3")).toBe(true);
  });
});

// ── validateCorpus aggregation ──

describe("SS-V0 validateCorpus", () => {
  test("validateCorpus concatenates all per-rule errors and warnings", () => {
    const spec = normSpec(minimalSpec("spec-a"));
    // One error (V2-1) and one warning (V2-3 fires only with missing plan,
    // but spec still has companion → rely on a single error scenario).
    const plan = normPlan(minimalPlan("plan-a", "spec-missing"));
    const registry = buildRegistry([spec], [plan]);
    const report = validateCorpus(registry);
    expect(report.errors.some((e) => e.check === "V2-1")).toBe(true);
    // spec-a has no companion plan, so V2-3 fires as a warning.
    expect(report.warnings.some((w) => w.check === "V2-3")).toBe(true);
  });
});
