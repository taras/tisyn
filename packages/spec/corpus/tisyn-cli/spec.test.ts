// Integration tests for the structured tisyn-cli spec corpus.
// Verifies the authored module normalizes cleanly and that the
// section-keyed rule ID scheme and section refs stay consistent.

import { describe, expect, test } from "vitest";
import { normalizeSpec } from "../../src/normalize.ts";
import { collectRules } from "../../src/walk.ts";
import { tisynCliSpec } from "./spec.ts";

describe("tisyn-cli corpus spec", () => {
  test("normalizes without structural errors", () => {
    const result = normalizeSpec(tisynCliSpec);
    if (!result.ok) {
      throw new Error(`normalize failed: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  test("has at least one rule", () => {
    const rules = collectRules(tisynCliSpec);
    expect(rules.length).toBeGreaterThan(0);
  });

  test("every rule ID follows the CLI-{section}-R{n} scheme", () => {
    const rules = collectRules(tisynCliSpec);
    for (const rule of rules) {
      expect(rule.id).toMatch(/^CLI-[\d.]+-R\d+$/);
    }
  });
});
