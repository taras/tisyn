import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorkflowModule } from "@tisyn/compiler";

// Resolve paths relative to the project root (one level up from src/ or dist/)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const workflowDir = resolve(projectRoot, "test/browser/workflows");
const outputPath = resolve(projectRoot, "test/browser/workflows.generated.ts");

// Read shared declarations (imports + declare function blocks)
const declarations = readFileSync(resolve(workflowDir, "declarations.ts"), "utf-8");

// Read all workflow source files (just exported functions, no declares)
const workflowFiles = readdirSync(workflowDir).filter((f) => f.endsWith(".workflow.ts"));
const workflowBodies = workflowFiles.map((f) => readFileSync(resolve(workflowDir, f), "utf-8"));

// Combine into a single source for the compiler
const combined = [declarations, "", ...workflowBodies].join("\n");

const { source: generated } = generateWorkflowModule(combined, {
  filename: "workflows.ts",
});

writeFileSync(outputPath, generated);
console.log(`Compiled ${workflowFiles.length} test workflows → workflows.generated.ts`);
