// SS-SER — Serializable domain tests per §5.2 of spec-system-test-plan.source.md.
//
// §3.1 defines the portable serializable data domain; §3.2 enumerates excluded
// values. JSON round-trip is the practical conformance check (§3.3). These
// tests verify constructor outputs stay inside the domain and that a local
// detector flags hostile values that upstream structural validation will later
// refuse.

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
  TestPlanSection,
  UnchangedSection,
} from "./constructors.ts";
import { ChangeType, Resolution, Status, Strength, Tier } from "./enums.ts";

// Detects any value outside the portable serializable data domain (§3).
function containsBanned(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null) {
    return false;
  }
  const t = typeof value;
  if (t === "function" || t === "symbol" || t === "bigint") {
    return true;
  }
  if (t === "number") {
    return !Number.isFinite(value as number);
  }
  if (t === "string" || t === "boolean") {
    return false;
  }
  if (t !== "object") {
    return true;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return true;
  } // cycle
  seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.some((v) => containsBanned(v, seen));
  }
  // plain object only — prototype chain must be Object.prototype or null
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return true;
  }
  for (const key of Object.keys(obj)) {
    if (containsBanned((obj as Record<string, unknown>)[key], seen)) {
      return true;
    }
  }
  return false;
}

function allConstructorOutputs(): unknown[] {
  return [
    Spec({
      id: "sp-x",
      title: "X",
      version: "0.1.0",
      status: Status.Active,
      sections: [Section({ id: "s1", title: "T", normative: true, prose: "." })],
      rules: [
        Rule({
          id: "X-R1",
          section: "s1",
          strength: Strength.MUST,
          statement: "s",
        }),
      ],
    }),
    TestPlan({
      id: "sp-x-tp",
      title: "X",
      version: "0.1.0",
      status: Status.Active,
      testsSpec: DependsOn("sp-x"),
      sections: [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })],
      categoriesSectionId: "matrix",
      categories: [
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
      ],
      coreTier: 1,
      extendedTier: 0,
    }),
    Section({ id: "s1", title: "T", normative: true, prose: "." }),
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
          changeType: ChangeType.Added,
        }),
      ],
      unchangedSections: [UnchangedSection({ targetSpec: "sp-y", section: "s2" })],
      preservedBehavior: [],
      newBehavior: [],
    }),
    TestCategory({ id: "c", title: "T", tests: [] }),
    TestCase({
      id: "X-T1",
      tier: Tier.Core,
      rules: ["X-R1"],
      description: "d",
      setup: "s",
      expected: "e",
    }),
    Covers("X-R1", ["X-T1"]),
    NonTest({ id: "NT1", description: "d", reason: "r" }),
    Ambiguity({
      id: "A1",
      specSection: "s1",
      description: "d",
      resolution: Resolution.Deferred,
    }),
  ];
}

describe("SS-SER", () => {
  test("SS-SER-001 allowed primitives (null, boolean, number, string) pass", () => {
    // prose carries strings; normative is boolean; coreTier is number; no null required.
    for (const value of allConstructorOutputs()) {
      expect(containsBanned(value)).toBe(false);
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    }
  });

  test("SS-SER-002 undefined in a field is flagged as out-of-domain", () => {
    const hostile = { tisyn_spec: "rule", id: "X-R1", statement: undefined };
    expect(containsBanned(hostile)).toBe(true);
  });

  test("SS-SER-003 NaN in a numeric field is flagged", () => {
    const hostile = {
      tisyn_spec: "test-plan",
      id: "p",
      coreTier: Number.NaN,
    };
    expect(containsBanned(hostile)).toBe(true);
  });

  test("SS-SER-004 Infinity in a numeric field is flagged", () => {
    const hostile = {
      tisyn_spec: "test-plan",
      id: "p",
      coreTier: Number.POSITIVE_INFINITY,
    };
    expect(containsBanned(hostile)).toBe(true);
  });

  test("SS-SER-005 class instance (Date) is flagged", () => {
    const hostile = {
      tisyn_spec: "rule",
      id: "X-R1",
      createdAt: new Date(),
    };
    expect(containsBanned(hostile)).toBe(true);
  });

  test("SS-SER-006 function value is flagged", () => {
    const hostile = {
      tisyn_spec: "rule",
      id: "X-R1",
      helper: () => 1,
    };
    expect(containsBanned(hostile)).toBe(true);
  });
});
