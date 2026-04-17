// Regenerates packages/spec/corpus/tisyn-cli/__fixtures__/original-*.md by
// rendering the current v2 modules. Run with: tsx scripts/regenerate-tisyn-cli-fixtures.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderSpecMarkdown,
  renderTestPlanMarkdown,
} from "../src/markdown/index.ts";
import { tisynCliSpec, tisynCliTestPlan } from "../corpus/tisyn-cli/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "corpus", "tisyn-cli", "__fixtures__");
mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(resolve(OUT_DIR, "original-spec.md"), renderSpecMarkdown(tisynCliSpec));
writeFileSync(
  resolve(OUT_DIR, "original-test-plan.md"),
  renderTestPlanMarkdown(tisynCliTestPlan),
);
console.log(`Wrote frozen fixtures to ${OUT_DIR}`);
