// Regenerates the canonical emitted-markdown tree at <repoRoot>/specs/ by
// rendering the current v2 corpus modules. Run with:
//   pnpm --filter @tisyn/spec exec tsx scripts/regenerate-emitted-specs.ts
//
// Mirror of regenerate-tisyn-cli-fixtures.ts but targeting the emitted tree
// that `verify-corpus` compares live-rendered markdown against. When the
// renderer or structured corpus changes, run this so `verify-corpus` keeps
// passing.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderSpecMarkdown,
  renderTestPlanMarkdown,
} from "../src/markdown/index.ts";
import { tisynCliSpec, tisynCliTestPlan } from "../corpus/tisyn-cli/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "specs");

const targets: ReadonlyArray<[string, string]> = [
  ["tisyn-cli-specification.md", renderSpecMarkdown(tisynCliSpec)],
  ["tisyn-cli-test-plan.md", renderTestPlanMarkdown(tisynCliTestPlan)],
];

for (const [name, body] of targets) {
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, body);
  console.log(`wrote ${path}`);
}
