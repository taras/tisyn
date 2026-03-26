import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorkflowModule } from "@tisyn/compiler";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const workflowDir = resolve(projectRoot, "test/browser/workflows");

// ── Pass 1: Compile dom workflows ──

const domDeclarations = await readFile(resolve(workflowDir, "dom-declarations.ts"), "utf-8");
const domDir = resolve(workflowDir, "dom");
const domFiles = (await readdir(domDir)).filter((f) => f.endsWith(".workflow.ts"));
const domBodies = await Promise.all(domFiles.map((f) => readFile(resolve(domDir, f), "utf-8")));

const domSource = [domDeclarations, "", ...domBodies].join("\n");
const domResult = generateWorkflowModule(domSource, {
  filename: "dom-workflows.ts",
  workflowFormat: "json",
});

await writeFile(resolve(projectRoot, "test/browser/dom-workflows.generated.ts"), domResult.source);
console.log(`Compiled ${domFiles.length} dom workflows → dom-workflows.generated.ts`);

// ── Pass 2: Compile host workflows ──

const hostDeclarations = await readFile(resolve(workflowDir, "host-declarations.ts"), "utf-8");
const allFiles = await readdir(workflowDir);
const hostFiles = allFiles.filter((f) => f.endsWith(".workflow.ts"));
const hostBodies = await Promise.all(
  hostFiles.map((f) => readFile(resolve(workflowDir, f), "utf-8")),
);

// declare stubs so the compiler's TS parser accepts dom IR free variables
const domRefStubs = Object.keys(domResult.workflows)
  .map((n) => `declare const ${n}: unknown;`)
  .join("\n");

const hostSource = [hostDeclarations, "", domRefStubs, "", ...hostBodies].join("\n");
const hostResult = generateWorkflowModule(hostSource, {
  filename: "host-workflows.ts",
});

await writeFile(
  resolve(projectRoot, "test/browser/host-workflows.generated.ts"),
  hostResult.source,
);
console.log(`Compiled ${hostFiles.length} host workflows → host-workflows.generated.ts`);
