// Emit canonical specs/tisyn-cli-*.md from the structured corpus.
//
// After this script runs:
//   specs/tisyn-cli-specification.md  — generator output (banner-prefixed)
//   specs/tisyn-cli-test-plan.md      — generator output (banner-prefixed)
//
// The CI drift check (see .github/workflows/ci.yml) re-runs this script
// and fails if `git diff --exit-code` reports any change — that's how the
// corpus ↔ committed-Markdown invariant stays enforced over time.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { normalizeSpec, normalizeTestPlan } from "../src/index.ts";
import { renderSpecMarkdown, renderTestPlanMarkdown } from "../src/markdown/index.ts";
import { tisynCliSpec, tisynCliTestPlan } from "../corpus/tisyn-cli/index.ts";

// Prose titles for the two specs the tisyn-cli corpus references via
// DependsOn / Complements — the renderer defaults to the raw spec id
// when no resolver is supplied, so this map restores the full titles
// on `Depends on:` / `Complements:` lines. The same two-entry map
// lives in `workflows/corpus-agent.ts`; intentionally not extracted
// into a shared helper per feedback_no_trivial_wrappers.
const RELATIONSHIP_TITLES = new Map<string, string>([
  ["tisyn-compiler", "Tisyn Compiler Specification"],
  ["tisyn-config", "Tisyn Configuration Specification"],
]);

export interface EmitTargets {
  readonly specPath: string;
  readonly testPlanPath: string;
}

export interface EmitResult {
  readonly spec: string;
  readonly testPlan: string;
}

/**
 * Pure renderer: no filesystem, no CWD, no writes. Used by the
 * emitter's unit test and by the public `emit` to produce the strings
 * that land on disk.
 */
export function renderCliMarkdown(): EmitResult {
  const specResult = normalizeSpec(tisynCliSpec);
  if (!specResult.ok) {
    throw new Error(`spec normalize failed: ${JSON.stringify(specResult.errors, null, 2)}`);
  }
  const planResult = normalizeTestPlan(tisynCliTestPlan);
  if (!planResult.ok) {
    throw new Error(`test plan normalize failed: ${JSON.stringify(planResult.errors, null, 2)}`);
  }
  const ruleSections = new Map<string, string>();
  for (const rule of specResult.value.rules) {
    ruleSections.set(rule.id, rule.section);
  }
  return {
    spec: renderSpecMarkdown(specResult.value, {
      relationshipTitle: (id) => RELATIONSHIP_TITLES.get(id),
    }),
    testPlan: renderTestPlanMarkdown(planResult.value, {
      ruleSection: (id) => ruleSections.get(id),
      validatesLabel: specResult.value.title,
    }),
  };
}

/**
 * Write the rendered markdown to the given target paths. Used by both
 * the CLI entrypoint (below) and by the unit test, which passes temp
 * paths so the real specs/ directory is never touched during testing.
 */
export async function emit(targets: EmitTargets): Promise<EmitResult> {
  const output = renderCliMarkdown();
  await writeFile(targets.specPath, output.spec);
  await writeFile(targets.testPlanPath, output.testPlan);
  return output;
}

// CLI entrypoint — resolve the monorepo's canonical specs/ paths and
// write. Guarded so `import` of this file for testing doesn't trigger
// a write.
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith("/emit-cli-markdown.ts");

if (invokedAsScript && process.argv[1]?.endsWith("emit-cli-markdown.ts")) {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  await emit({
    specPath: resolve(repoRoot, "specs/tisyn-cli-specification.md"),
    testPlanPath: resolve(repoRoot, "specs/tisyn-cli-test-plan.md"),
  });
}
