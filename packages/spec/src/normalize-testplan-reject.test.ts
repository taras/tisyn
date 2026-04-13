// SS-NR (test-plan rows) — Structural rejection tests per §5.5 of
// spec-system-test-plan.source.md. Covers SS-NR-004, 013, 014, 016, 017.

import { describe, expect, test } from "vitest";
import {
  DependsOn,
  TestCase,
  TestCategory,
  TestPlan,
} from "./constructors.ts";
import { Status, Tier } from "./enums.ts";
import { normalizeTestPlan } from "./normalize.ts";
import type { StructuralError, TestPlanModule } from "./types.ts";

function expectReject(
  module: TestPlanModule,
  code: string,
): readonly StructuralError[] {
  const result = normalizeTestPlan(module);
  expect(result.ok).toBe(false);
  if (result.ok) {throw new Error("unreachable");}
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

describe("SS-NR (test plan)", () => {
  test("SS-NR-004 Empty test-plan id rejected (EMPTY_TESTPLAN_ID)", () => {
    expectReject(
      TestPlan({
        id: "",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x"),
        categories: [
          TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] }),
        ],
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
        categories: [
          TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] }),
        ],
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
        categories: [
          TestCategory({ id: "c", title: "C", tests: [basicCoreTestCase()] }),
        ],
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
});
