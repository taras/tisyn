// Unit tests for the deterministic test-plan Markdown renderer.

import { describe, expect, test } from "vitest";
import {
  Ambiguity,
  Covers,
  DependsOn,
  NonTest,
  TestCase,
  TestCategory,
  TestPlan,
} from "../constructors.ts";
import { Resolution, Status, Tier } from "../enums.ts";
import { normalizeTestPlan } from "../normalize.ts";
import type { NormalizedTestPlanModule, TestPlanModule } from "../types.ts";
import { renderTestPlanMarkdown } from "./render-test-plan.ts";

function norm(m: TestPlanModule): NormalizedTestPlanModule {
  const r = normalizeTestPlan(m);
  if (!r.ok) {
    throw new Error(`normalize failed: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}

describe("renderTestPlanMarkdown", () => {
  test("renders one category one test as table row", () => {
    const plan = norm(
      TestPlan({
        id: "plan-x",
        title: "Plan X",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "Command Surface",
            tests: [
              TestCase({
                id: "CLI-CMD-001",
                tier: Tier.Core,
                rules: ["CLI-1-R1"],
                description: "tsn --help works",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
        coverageMatrix: [Covers("CLI-1-R1", ["CLI-CMD-001"])],
      }),
    );
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("# Plan X");
    expect(md).toContain("**Validates:** sp-x");
    expect(md).toContain("## A. Command Surface");
    expect(md).toContain("| ID | P | Type | Spec | Assertion |");
    expect(md).toContain("| CLI-CMD-001 | P0 | E2E | CLI-1-R1 | tsn --help works |");
  });

  test("tier maps to P0/P1", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "CLI-T-001",
                tier: Tier.Core,
                rules: ["R"],
                description: "core",
                setup: "",
                expected: "",
              }),
              TestCase({
                id: "CLI-T-002",
                tier: Tier.Extended,
                rules: ["R"],
                description: "extended",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 1,
      }),
    );
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("| CLI-T-001 | P0 |");
    expect(md).toContain("| CLI-T-002 | P1 |");
  });

  test("[Unit] prefix maps to Type column and is stripped from assertion", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "CLI-T-001",
                tier: Tier.Core,
                rules: ["R"],
                description: "[Unit] pure helper returns zero",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
      }),
    );
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("| CLI-T-001 | P0 | Unit | R | pure helper returns zero |");
  });

  test("ruleSection lookup resolves spec refs", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "CLI-T-001",
                tier: Tier.Core,
                rules: ["CLI-2.1-R1", "CLI-3.4-R2"],
                description: "works",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
      }),
    );
    const md = renderTestPlanMarkdown(plan, {
      ruleSection: (id) => (id === "CLI-2.1-R1" ? "2.1" : id === "CLI-3.4-R2" ? "3.4" : undefined),
    });
    expect(md).toContain("§2.1");
    expect(md).toContain("§3.4");
    expect(md).not.toContain("| CLI-2.1-R1,");
  });

  test("coverage matrix renders as bullet list", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "CLI-T-001",
                tier: Tier.Core,
                rules: ["R1"],
                description: "x",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
        coverageMatrix: [Covers("R1", ["CLI-T-001"])],
      }),
    );
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("## Coverage Matrix");
    expect(md).toContain("- R1 → CLI-T-001");
  });

  test("non-tests and ambiguity surface render as bullet lists", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "CLI-T-001",
                tier: Tier.Core,
                rules: ["R"],
                description: "x",
                setup: "",
                expected: "",
              }),
            ],
          }),
        ],
        coreTier: 1,
        extendedTier: 0,
        nonTests: [NonTest({ id: "NT-1", description: "deferred", reason: "scope" })],
        ambiguitySurface: [
          Ambiguity({
            id: "AMB-1",
            specSection: "1",
            description: "open",
            resolution: Resolution.Deferred,
          }),
        ],
      }),
    );
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("## Non-Tests");
    expect(md).toContain("- **NT-1** — deferred");
    expect(md).toContain("  **Reason:** scope");
    expect(md).toContain("## Ambiguity Surface");
    expect(md).toContain("- **AMB-1** (deferred) — open");
  });

  test("is deterministic: same input → byte-equal output", () => {
    const build = () =>
      norm(
        TestPlan({
          id: "p",
          title: "P",
          version: "0.1.0",
          status: Status.Active,
          testsSpec: DependsOn("sp-x", "0.1.0"),
          categories: [
            TestCategory({
              id: "CLI-TC-A",
              title: "A",
              tests: [
                TestCase({
                  id: "CLI-T-001",
                  tier: Tier.Core,
                  rules: ["R"],
                  description: "x",
                  setup: "",
                  expected: "",
                }),
              ],
            }),
          ],
          coreTier: 1,
          extendedTier: 0,
        }),
      );
    const a = renderTestPlanMarkdown(build());
    const b = renderTestPlanMarkdown(build());
    expect(a).toBe(b);
  });
});
