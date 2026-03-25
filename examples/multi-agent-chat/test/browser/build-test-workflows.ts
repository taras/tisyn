import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorkflowModule } from "@tisyn/compiler";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowDir = resolve(__dirname, "workflows");
const outputPath = resolve(__dirname, "workflows.generated.ts");

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
