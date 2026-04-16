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
  TestPlanSection,
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

const MATRIX_SECTIONS = [
  TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
];
const MATRIX_CATEGORIES_SECTION_ID = "matrix";

describe("renderTestPlanMarkdown", () => {
  test("renders one category one test as table row", () => {
    const plan = norm(
      TestPlan({
        id: "plan-x",
        title: "Plan X",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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
    expect(md).toContain("### A. Command Surface");
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
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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

  test("coverage matrix is NOT rendered as an H2 appendix", () => {
    // coverageMatrix is data used by checkCoverage/isReady only; it is NOT
    // rendered to Markdown. Per-rule coverage shows up via each test row's
    // Spec column, not a bullet-list appendix.
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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
    expect(md).not.toContain("## Coverage Matrix");
    expect(md).not.toContain("- R1 → CLI-T-001");
  });

  test("non-tests and ambiguity surface render as bullet lists", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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
          sections: MATRIX_SECTIONS,
          categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
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

  // ── Section walk: numbering, nesting, dividers, unnumbered sections ──

  test("depth-2 numbered section renders as '## N. Title' with period", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: [
          TestPlanSection({ id: "1", number: "1", title: "Purpose", prose: "A sentence." }),
          TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
        ],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("## 1. Purpose");
    expect(md).toContain("A sentence.");
    expect(md).toContain("## 6. Test Matrix");
  });

  test("depth-3 numbered subsection renders as '### N.M Title' (no period)", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: [
          TestPlanSection({
            id: "4",
            number: "4",
            title: "Test Strategy",
            prose: "",
            subsections: [
              TestPlanSection({
                id: "4.1",
                number: "4.1",
                title: "Priority Model",
                prose: "tier rules",
              }),
            ],
          }),
          TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
        ],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("## 4. Test Strategy");
    expect(md).toContain("### 4.1 Priority Model");
    expect(md).not.toContain("### 4.1. Priority Model");
  });

  test("unnumbered top-level section renders without a number prefix", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: [
          TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
          TestPlanSection({
            id: "risks",
            title: "Highest-Risk Drift Areas",
            prose: "Risk list.",
          }),
        ],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("## Highest-Risk Drift Areas");
    expect(md).toContain("Risk list.");
  });

  test("precedingDivider emits '---' before a non-first section", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: [
          TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
          TestPlanSection({
            id: "7",
            number: "7",
            title: "Summary",
            prose: "done",
            precedingDivider: true,
          }),
        ],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    // The divider pattern appears immediately before `## 7. Summary`.
    expect(md).toMatch(/---\n\n## 7\. Summary/);
  });

  test("precedingDivider on the first top-level section is suppressed", () => {
    // The metadata block already ends with `---`; a divider-before-first
    // top-level section would collapse into a double rule.
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: [
          TestPlanSection({
            id: "1",
            number: "1",
            title: "Purpose",
            prose: "first",
            precedingDivider: true,
          }),
          TestPlanSection({ id: "matrix", number: "6", title: "Test Matrix", prose: "" }),
        ],
        categoriesSectionId: "matrix",
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    // No double `---` just before `## 1. Purpose` — only the metadata rule.
    expect(md).not.toMatch(/---\n\n---\n\n## 1\. Purpose/);
    expect(md).toContain("## 1. Purpose");
  });

  test("styleReference adds a metadata line when set", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        styleReference: "Blocking Scope Conformance Test Plan",
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("**Style reference:** Blocking Scope Conformance Test Plan");
  });

  test("category.notes paragraph renders after the test table", () => {
    const plan = norm(
      TestPlan({
        id: "p",
        title: "P",
        version: "0.1.0",
        status: Status.Active,
        testsSpec: DependsOn("sp-x", "0.1.0"),
        sections: MATRIX_SECTIONS,
        categoriesSectionId: MATRIX_CATEGORIES_SECTION_ID,
        categories: [
          TestCategory({
            id: "CLI-TC-A",
            title: "A",
            notes: "**Note.** A note paragraph.",
            tests: [
              TestCase({
                id: "T-1",
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
    const md = renderTestPlanMarkdown(plan);
    expect(md).toContain("**Note.** A note paragraph.");
    // Notes appear AFTER the test row.
    const tableIdx = md.indexOf("| T-1 |");
    const notesIdx = md.indexOf("**Note.** A note paragraph.");
    expect(tableIdx).toBeGreaterThan(-1);
    expect(notesIdx).toBeGreaterThan(tableIdx);
  });
});
