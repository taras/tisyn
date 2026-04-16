// SS-NR (test-plan rows) — Structural rejection tests per §5.5 of
// spec-system-test-plan.source.md. Covers SS-NR-004, 013, 014, 016, 017.

import { describe, expect, test } from "vitest";
import { DependsOn, TestCase, TestCategory, TestPlan, TestPlanSection } from "./constructors.ts";
import { Status, Tier } from "./enums.ts";
import { normalizeTestPlan } from "./normalize.ts";
import type { StructuralError, TestPlanModule } from "./types.ts";

function expectReject(module: TestPlanModule, code: string): readonly StructuralError[] {
  const result = normalizeTestPlan(module);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  expect(result.errors.some((e) => e.code === code)).toBe(true);
  return result.errors;
}

function basicCoreTestCase(id: string = "X-T1") {
  return TestCase({
    id,
    tier: Tier.Core,
    rules: ["X-R1"],
    description: "d",
    setup: "s",
    expected: "e",
  });
}

const BASIC_SECTIONS = [TestPlanSection({ id: "matrix", title: "Test Matrix", prose: "" })];
const BASIC_CATEGORIES_SECTION_ID = "matrix";

describe("SS-NR (test plan)", () => {
  test("SS-NR-004 Empty test-plan id rejected (EMPTY_TESTPLAN_ID)", () => {
    expectReject(
      TestPlan({
        id: "",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "EMPTY_TESTPLAN_ID",
    );
  });

  test("SS-NR-013 coreTier mismatch rejected (CORE_TIER_MISMATCH)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 5, // actual = 1
        extendedTier: 0,
      }),
      "CORE_TIER_MISMATCH",
    );
  });

  test("SS-NR-014 extendedTier mismatch rejected (EXTENDED_TIER_MISMATCH)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 2, // actual = 0
      }),
      "EXTENDED_TIER_MISMATCH",
    );
  });

  test("SS-NR-016 TestCase with empty rules rejected (EMPTY_TESTCASE_RULES)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [
              TestCase({
                id: "X-T1",
                tier: Tier.Core,
                rules: [],
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
      "EMPTY_TESTCASE_RULES",
    );
  });

  test("SS-NR-017 TestCase with empty id rejected (EMPTY_TESTCASE_ID)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [
          TestCategory({
            id: "c",
            title: "C",
            tests: [basicCoreTestCase("")],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
      }),
      "EMPTY_TESTCASE_ID",
    );
  });

  test("SS-NR-023 Empty category id rejected (EMPTY_TESTCATEGORY_ID)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [TestCategory({ id: "", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "EMPTY_TESTCATEGORY_ID",
    );
  });

  test("SS-NR-024 Duplicate category id rejected (DUPLICATE_TESTCATEGORY_ID)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: BASIC_SECTIONS,
        categoriesSectionId: BASIC_CATEGORIES_SECTION_ID,
        categories: [
          TestCategory({ id: "dup", title: "A", tests: [basicCoreTestCase("X-T1")] }),
          TestCategory({ id: "dup", title: "B", tests: [basicCoreTestCase("X-T2")] }),
        ],
        coreTier: 2,
        extendedTier: 0,
      }),
      "DUPLICATE_TESTCATEGORY_ID",
    );
  });

  // ── TestPlanSection structural validation ──

  test("SS-NR-030 Empty section id rejected (EMPTY_TESTPLANSECTION_ID)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [TestPlanSection({ id: "", title: "Bad", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "EMPTY_TESTPLANSECTION_ID",
    );
  });

  test("SS-NR-031 Empty section title rejected (EMPTY_TESTPLANSECTION_TITLE)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [TestPlanSection({ id: "matrix", title: "", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "EMPTY_TESTPLANSECTION_TITLE",
    );
  });

  test("SS-NR-032 Invalid section number rejected (INVALID_TESTPLANSECTION_NUMBER)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [TestPlanSection({ id: "matrix", number: "1.", title: "Bad", prose: "" })],
        categoriesSectionId: "matrix",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "INVALID_TESTPLANSECTION_NUMBER",
    );
  });

  test("SS-NR-033 Duplicate section id across nesting rejected (DUPLICATE_TESTPLANSECTION_ID)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [
          TestPlanSection({
            id: "dup",
            title: "Parent",
            prose: "",
            subsections: [TestPlanSection({ id: "dup", title: "Child", prose: "" })],
          }),
          TestPlanSection({ id: "matrix", title: "Matrix", prose: "" }),
        ],
        categoriesSectionId: "matrix",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "DUPLICATE_TESTPLANSECTION_ID",
    );
  });

  test("SS-NR-034 Unresolved categoriesSectionId rejected (MISSING_CATEGORIES_SECTION)", () => {
    expectReject(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [TestPlanSection({ id: "matrix", title: "Matrix", prose: "" })],
        categoriesSectionId: "nope",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
      "MISSING_CATEGORIES_SECTION",
    );
  });

  test("SS-NR-035 categoriesSectionId resolves to nested section (accepts)", () => {
    // Nested resolution — the matrix slot can live under a parent section.
    const result = normalizeTestPlan(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        sections: [
          TestPlanSection({
            id: "outer",
            title: "Outer",
            prose: "",
            subsections: [TestPlanSection({ id: "matrix", title: "Matrix", prose: "" })],
          }),
        ],
        categoriesSectionId: "matrix",
        categories: [TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] })],
        coreTier: 1,
        extendedTier: 0,
      }),
    );
    expect(result.ok).toBe(true);
  });
});
