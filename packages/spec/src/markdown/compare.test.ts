// Unit tests for compareMarkdown + stripBanner.

import { describe, expect, test } from "vitest";
import { GENERATED_BANNER } from "./render-spec.ts";
import { compareMarkdown, stripBanner } from "./compare.ts";

describe("stripBanner", () => {
  test("removes the exact generated banner and one blank line", () => {
    const md = `${GENERATED_BANNER}\n\n# Title\n`;
    expect(stripBanner(md)).toBe("# Title\n");
  });

  test("passes through unbanner'd input unchanged", () => {
    const md = "# Title\n\nBody\n";
    expect(stripBanner(md)).toBe(md);
  });

  test("removes a loose `Generated from ...` comment too", () => {
    const md = "<!-- Generated from somewhere else -->\n\n# Title\n";
    expect(stripBanner(md)).toBe("# Title\n");
  });
});

describe("compareMarkdown", () => {
  test("identical inputs → ok:true, empty differences", () => {
    const md = "# Title\n\n## 1. A\n\n- item\n";
    const report = compareMarkdown(md, md);
    expect(report.ok).toBe(true);
    expect(report.differences).toHaveLength(0);
  });

  test("missing test ID surfaces in summary and differences", () => {
    const original = "# T\n\n## A\n\n| CLI-CMD-001 | P0 | E2E | §1 | x |\n";
    const generated = "# T\n\n## A\n\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(false);
    expect(report.summary.missingTestIds).toContain("CLI-CMD-001");
    expect(report.differences.some((d) => d.kind === "test-id")).toBe(true);
  });

  test("extra section heading surfaces in summary", () => {
    const original = "# T\n\n## 1. A\n";
    const generated = "# T\n\n## 1. A\n\n## 2. B\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(false);
    expect(report.summary.extraSections.some((s) => s.includes("2. B"))).toBe(true);
  });

  test("title mismatch produces a title difference", () => {
    const original = "# Original\n";
    const generated = "# Generated\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(false);
    expect(report.differences[0]?.kind).toBe("title");
  });

  test("reorder of relationship lines still matches", () => {
    const original = "# T\n\n**Depends on:** a\n**Complements:** b\n";
    const generated = "# T\n\n**Complements:** b\n**Depends on:** a\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(true);
  });

  test("banner on generated side is ignored in comparison", () => {
    const original = "# T\n\n## 1. A\n";
    const generated = `${GENERATED_BANNER}\n\n# T\n\n## 1. A\n`;
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(true);
  });

  test("missing coverage ref surfaces in summary", () => {
    const original = "# T\n\n## A\n\nSee §3.4 for details.\n";
    const generated = "# T\n\n## A\n\nSee details.\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(false);
    expect(report.summary.missingCoverageRefs).toContain("§3.4");
  });

  test("rule bullet wording differences do NOT fail compare", () => {
    const original = [
      "# T",
      "",
      "## 1. A",
      "",
      "| CLI-CMD-001 | P0 | E2E | §1 | the tool runs cleanly |",
      "",
    ].join("\n");
    const generated = [
      "# T",
      "",
      "## 1. A",
      "",
      "| CLI-CMD-001 | P0 | E2E | §1 | command executes without error |",
      "",
    ].join("\n");
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(true);
  });

  test("missing relationship line surfaces in summary", () => {
    const original = "# T\n\n**Depends on:** a\n";
    const generated = "# T\n";
    const report = compareMarkdown(original, generated);
    expect(report.ok).toBe(false);
    expect(report.summary.missingRelationships.length).toBeGreaterThan(0);
  });
});
