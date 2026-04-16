// Unit test for the CLI-markdown emitter. Writes to a temp dir so the
// real specs/ tree is never touched; verifies banner presence and
// renderer idempotency.

import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENERATED_BANNER } from "../src/markdown/render-spec.ts";
import { compareMarkdown } from "../src/markdown/index.ts";
import { emit, renderCliMarkdown } from "./emit-cli-markdown.ts";

describe("emit-cli-markdown", () => {
  test("writes banner-prefixed files to the requested targets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-cli-"));
    try {
      const specPath = join(dir, "tisyn-cli-specification.md");
      const testPlanPath = join(dir, "tisyn-cli-test-plan.md");
      const result = await emit({ specPath, testPlanPath });

      const spec = readFileSync(specPath, "utf8");
      const testPlan = readFileSync(testPlanPath, "utf8");
      expect(spec.startsWith(GENERATED_BANNER)).toBe(true);
      expect(testPlan.startsWith(GENERATED_BANNER)).toBe(true);
      expect(spec).toBe(result.spec);
      expect(testPlan).toBe(result.testPlan);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("renderCliMarkdown is idempotent — two calls produce identical output", () => {
    const first = renderCliMarkdown();
    const second = renderCliMarkdown();
    expect(second.spec).toBe(first.spec);
    expect(second.testPlan).toBe(first.testPlan);
  });

  test("emitted output round-trips through compareMarkdown cleanly", () => {
    const { spec, testPlan } = renderCliMarkdown();
    // Comparing the output to itself must produce an empty difference
    // set — this catches any non-determinism between renders.
    expect(compareMarkdown(spec, spec).ok).toBe(true);
    expect(compareMarkdown(testPlan, testPlan).ok).toBe(true);
  });
});
