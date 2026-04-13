// SS-CON — Constructor output tests per §5.1 of spec-system-test-plan.source.md.

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
  ImplementsSpec,
  Invariant,
  NonTest,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  UnchangedSection,
} from "./constructors.ts";
import { ChangeType, EvidenceTier, Resolution, Status, Strength, Tier } from "./enums.ts";

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function section1(): ReturnType<typeof Section> {
  return Section({
    id: "s1",
    title: "Intro",
    normative: true,
    prose: "prose",
  });
}

function specX() {
  return Spec({
    id: "sp-x",
    title: "X Spec",
    version: "0.1.0",
    status: Status.Active,
    sections: [section1()],
    rules: [
      Rule({
        id: "X-R1",
        section: "s1",
        strength: Strength.MUST,
        statement: "Something",
      }),
    ],
  });
}

function testPlanX() {
  return TestPlan({
    id: "sp-x-test-plan",
    title: "X Test Plan",
    version: "0.1.0",
    status: Status.Active,
    testsSpec: DependsOn("sp-x", "0.1.0"),
    categories: [
      TestCategory({
        id: "cat1",
        title: "Category 1",
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
  });
}

describe("SS-CON", () => {
  test("SS-CON-001 Spec() produces serializable SpecModule", () => {
    const spec = specX();
    expect(spec.tisyn_spec).toBe("spec");
    expect(spec.id).toBe("sp-x");
    expect(spec.version).toBe("0.1.0");
    expect(spec.status).toBe(Status.Active);
    expect(spec.sections).toHaveLength(1);
    expect(spec.rules).toHaveLength(1);
    expect(spec.dependsOn).toEqual([]);
    expect(roundTrip(spec)).toEqual(spec);
  });

  test("SS-CON-002 TestPlan() produces serializable TestPlanModule", () => {
    const plan = testPlanX();
    expect(plan.tisyn_spec).toBe("test-plan");
    expect(plan.id).toBe("sp-x-test-plan");
    expect(plan.testsSpec.specId).toBe("sp-x");
    expect(plan.categories).toHaveLength(1);
    expect(plan.coreTier).toBe(1);
    expect(plan.extendedTier).toBe(0);
    expect(roundTrip(plan)).toEqual(plan);
  });

  test("SS-CON-003 Section() produces SpecSection", () => {
    const section = section1();
    expect(section.tisyn_spec).toBe("section");
    expect(section.id).toBe("s1");
    expect(section.normative).toBe(true);
    expect(section.subsections).toEqual([]);
  });

  test("SS-CON-004 Rule() produces RuleDeclaration", () => {
    const rule = Rule({
      id: "X-R1",
      section: "s1",
      strength: Strength.MUST,
      statement: "do the thing",
    });
    expect(rule.tisyn_spec).toBe("rule");
    expect(rule.id).toBe("X-R1");
    expect(rule.strength).toBe(Strength.MUST);
    expect(rule.statement).toBe("do the thing");
  });

  test("SS-CON-005 ErrorCode() produces ErrorCodeDeclaration", () => {
    const ec = ErrorCode({
      code: "X-E1",
      section: "s1",
      trigger: "trigger text",
      requiredContent: ["detail"],
    });
    expect(ec.tisyn_spec).toBe("error-code");
    expect(ec.code).toBe("X-E1");
    expect(ec.trigger).toBe("trigger text");
    expect(ec.requiredContent).toEqual(["detail"]);
  });

  test("SS-CON-006 TestCase() produces TestCase with tier and rules", () => {
    const tc = TestCase({
      id: "X-T1",
      tier: Tier.Core,
      rules: ["X-R1"],
      description: "d",
      setup: "s",
      expected: "e",
    });
    expect(tc.tisyn_spec).toBe("test");
    expect(tc.tier).toBe(Tier.Core);
    expect(tc.rules).toEqual(["X-R1"]);
    // D33 default applies in constructor (SS-AMB-005)
    expect(tc.evidence).toBe(EvidenceTier.Normative);
  });

  test("SS-CON-007 Covers() produces CoverageEntry", () => {
    const entry = Covers("X-R1", ["X-T1", "X-T2"]);
    expect(entry.ruleId).toBe("X-R1");
    expect(entry.testIds).toEqual(["X-T1", "X-T2"]);
  });

  test("SS-CON-008 Ambiguity() produces AmbiguityFinding with Resolution enum", () => {
    const amb = Ambiguity({
      id: "SS-AMB-001",
      specSection: "s1",
      description: "d",
      resolution: Resolution.Deferred,
    });
    expect(amb.resolution).toBe(Resolution.Deferred);
    expect(amb.id).toBe("SS-AMB-001");
  });

  test("SS-CON-009 Constructor purity — Rule() twice yields identical values", () => {
    const args = {
      id: "X-R1",
      section: "s1",
      strength: Strength.MUST,
      statement: "do it",
    } as const;
    expect(Rule(args)).toEqual(Rule(args));
  });

  test("SS-CON-010 All 21 constructors round-trip through JSON", () => {
    const values: unknown[] = [
      specX(),
      testPlanX(),
      section1(),
      Rule({
        id: "X-R1",
        section: "s1",
        strength: Strength.MUST,
        statement: "s",
      }),
      ErrorCode({ code: "X-E1", section: "s1", trigger: "t" }),
      Concept({ name: "C", section: "s1", description: "d" }),
      Invariant({ id: "X-I1", section: "s1", statement: "s" }),
      Term({ term: "t", section: "s1", definition: "d" }),
      DependsOn("sp-y", "1.0.0"),
      Amends("sp-y", "1.0.0", ["s1"]),
      Complements("sp-y"),
      ImplementsSpec("sp-y"),
      Amendment({
        changedSections: [
          ChangedSection({
            targetSpec: "sp-y",
            section: "s1",
            changeType: ChangeType.Modified,
          }),
        ],
        unchangedSections: [UnchangedSection({ targetSpec: "sp-y", section: "s2" })],
        preservedBehavior: ["p"],
        newBehavior: ["n"],
      }),
      TestCategory({
        id: "c",
        title: "T",
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
      TestCase({
        id: "X-T1",
        tier: Tier.Extended,
        rules: ["X-R1"],
        description: "d",
        setup: "s",
        expected: "e",
      }),
      Covers("X-R1", ["X-T1"]),
      NonTest({ id: "NT1", description: "d", reason: "r" }),
      Ambiguity({
        id: "SS-AMB-001",
        specSection: "s1",
        description: "d",
        resolution: Resolution.Resolved,
        resolvedIn: "0.1.0",
      }),
    ];
    for (const v of values) {
      expect(roundTrip(v)).toEqual(v);
    }
    expect(values.length).toBe(18);
  });

  test("SS-CON-011 Discriminants are string literals", () => {
    const spec = specX();
    const rule = spec.rules[0]!;
    const tc = TestCase({
      id: "X-T1",
      tier: Tier.Core,
      rules: ["X-R1"],
      description: "d",
      setup: "s",
      expected: "e",
    });
    expect(typeof spec.tisyn_spec).toBe("string");
    expect(spec.tisyn_spec).toBe("spec");
    expect(typeof rule.tisyn_spec).toBe("string");
    expect(rule.tisyn_spec).toBe("rule");
    expect(typeof tc.tisyn_spec).toBe("string");
    expect(tc.tisyn_spec).toBe("test");
  });

  test("SS-CON-012 No tisyn or tisyn_config fields on spec data", () => {
    const spec = specX();
    const plan = testPlanX();
    const samples: Record<string, unknown>[] = [
      spec,
      plan,
      spec.sections[0] as Record<string, unknown>,
      spec.rules[0] as Record<string, unknown>,
      plan.categories[0] as Record<string, unknown>,
      plan.categories[0]!.tests[0] as Record<string, unknown>,
    ];
    for (const obj of samples) {
      expect("tisyn" in obj).toBe(false);
      expect("tisyn_config" in obj).toBe(false);
      expect("tisyn_spec" in obj).toBe(true);
    }
  });

  test("SS-CON-013 Enum values serialize to string backing (A8)", () => {
    const spec = specX();
    const json = JSON.stringify(spec);
    expect(json).toContain('"status":"active"');
    expect(json).not.toContain("Status.Active");
    expect(json).toContain('"strength":"MUST"');
  });

  test("SS-CON-014 remaining constructors have correct shape", () => {
    const concept = Concept({ name: "C", section: "s1", description: "d" });
    expect(concept.tisyn_spec).toBe("concept");
    expect(concept.name).toBe("C");

    const inv = Invariant({ id: "X-I1", section: "s1", statement: "s" });
    expect(inv.tisyn_spec).toBe("invariant");
    expect(inv.id).toBe("X-I1");

    const term = Term({ term: "t", section: "s1", definition: "d" });
    expect(term.tisyn_spec).toBe("term");
    expect(term.term).toBe("t");

    const dep = DependsOn("sp-y", "1.0.0");
    expect(dep.specId).toBe("sp-y");
    expect(dep.version).toBe("1.0.0");

    const amends = Amends("sp-y", "1.0.0", ["s1"]);
    expect(amends.specId).toBe("sp-y");
    expect(amends.sections).toEqual(["s1"]);

    const comp = Complements("sp-y");
    expect(comp.specId).toBe("sp-y");
    expect("version" in comp).toBe(false);

    const impl = ImplementsSpec("sp-y");
    expect(impl.specId).toBe("sp-y");

    const amendment = Amendment({
      changedSections: [],
      unchangedSections: [],
      preservedBehavior: [],
      newBehavior: [],
    });
    expect(amendment.changedSections).toEqual([]);

    const changed = ChangedSection({
      targetSpec: "sp-y",
      section: "s1",
      changeType: ChangeType.Added,
    });
    expect(changed.changeType).toBe(ChangeType.Added);

    const unchanged = UnchangedSection({ targetSpec: "sp-y", section: "s1" });
    expect(unchanged.targetSpec).toBe("sp-y");

    const cat = TestCategory({ id: "c", title: "T", tests: [] });
    expect(cat.tisyn_spec).toBe("test-category");
    expect(cat.id).toBe("c");

    const nt = NonTest({ id: "NT1", description: "d", reason: "r" });
    expect(nt.id).toBe("NT1");
  });
});
