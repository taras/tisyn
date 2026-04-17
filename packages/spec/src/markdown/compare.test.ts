// SS-RN compareMarkdown — structural multiset diff over headings,
// relationships, test ids, §-refs. Prose wording is out of scope.

import { describe, expect, it } from "vitest";
import { compareMarkdown } from "./compare.ts";
import { renderSpecMarkdown } from "./render-spec.ts";
import { fixtureAlpha } from "../__fixtures__/index.ts";

describe("SS-RN compareMarkdown", () => {
  it("matches identical documents", () => {
    const out = renderSpecMarkdown(fixtureAlpha);
    const result = compareMarkdown(out, out);
    expect(result.match).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it("is insensitive to prose wording differences", () => {
    const a = "# Title\n\nSome prose.\n\n## §1 Core\n";
    const b = "# Title\n\nDifferent words here.\n\n## §1 Core\n";
    expect(compareMarkdown(a, b).match).toBe(true);
  });

  it("detects a missing section heading", () => {
    const a = "## §1 Core\n## §2 Extras\n";
    const b = "## §1 Core\n";
    const result = compareMarkdown(a, b);
    expect(result.match).toBe(false);
    expect(result.differences.some((d) => d.kind === "section-heading")).toBe(true);
  });

  it("detects a missing relationship line", () => {
    const a = "- depends-on: spec-a\n- depends-on: spec-b\n";
    const b = "- depends-on: spec-a\n";
    const result = compareMarkdown(a, b);
    expect(result.differences.some((d) => d.kind === "relationship-line")).toBe(true);
  });
});
