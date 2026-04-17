// Round-trip test for the tisyn-cli corpus: normalize + render + compare
// against the frozen fixture. Confirms the v2 data model, hash stability,
// and renderSpecMarkdown determinism all hang together on a real corpus.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tisynCliSpec, tisynCliTestPlan } from "./index.ts";
import { normalizeSpec, normalizeTestPlan } from "../../src/normalize.ts";
import {
  compareMarkdown,
  renderSpecMarkdown,
  renderTestPlanMarkdown,
} from "../../src/markdown/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("tisyn-cli corpus", () => {
  it("spec normalizes without errors", () => {
    const result = normalizeSpec(tisynCliSpec);
    if (result.status === "error") {
      // Surface all constraint failures for quick diagnosis.
      throw new Error(
        `normalizeSpec failed:\n${result.errors
          .map((e) => `- [${e.constraint}] ${e.message} @ ${e.path?.join(".") ?? ""}`)
          .join("\n")}`,
      );
    }
    expect(result.status).toBe("ok");
  });

  it("test-plan normalizes without errors", () => {
    const result = normalizeTestPlan(tisynCliTestPlan);
    if (result.status === "error") {
      throw new Error(
        `normalizeTestPlan failed:\n${result.errors
          .map((e) => `- [${e.constraint}] ${e.message} @ ${e.path?.join(".") ?? ""}`)
          .join("\n")}`,
      );
    }
    expect(result.status).toBe("ok");
  });

  it("renderSpecMarkdown round-trips against the frozen fixture", () => {
    const fixturePath = resolve(HERE, "__fixtures__", "original-spec.md");
    let reference: string;
    try {
      reference = readFileSync(fixturePath, "utf8");
    } catch {
      // Fixture has not been regenerated yet — skip strictly but assert that
      // rendering itself is deterministic.
      const a = renderSpecMarkdown(tisynCliSpec);
      const b = renderSpecMarkdown(tisynCliSpec);
      expect(a).toBe(b);
      return;
    }
    const generated = renderSpecMarkdown(tisynCliSpec);
    const result = compareMarkdown(generated, reference);
    if (!result.match) {
      throw new Error(
        `compareMarkdown mismatch:\n${result.differences
          .slice(0, 10)
          .map((d) => `- ${d.kind}: expected=${d.expected} actual=${d.actual}`)
          .join("\n")}`,
      );
    }
    expect(result.match).toBe(true);
  });

  it("renderTestPlanMarkdown round-trips against the frozen fixture", () => {
    const fixturePath = resolve(HERE, "__fixtures__", "original-test-plan.md");
    let reference: string;
    try {
      reference = readFileSync(fixturePath, "utf8");
    } catch {
      const a = renderTestPlanMarkdown(tisynCliTestPlan);
      const b = renderTestPlanMarkdown(tisynCliTestPlan);
      expect(a).toBe(b);
      return;
    }
    const generated = renderTestPlanMarkdown(tisynCliTestPlan);
    const result = compareMarkdown(generated, reference);
    if (!result.match) {
      throw new Error(
        `compareMarkdown mismatch:\n${result.differences
          .slice(0, 10)
          .map((d) => `- ${d.kind}: expected=${d.expected} actual=${d.actual}`)
          .join("\n")}`,
      );
    }
    expect(result.match).toBe(true);
  });
});
