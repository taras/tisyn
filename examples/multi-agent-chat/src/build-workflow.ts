import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorkflowModule } from "@tisyn/compiler";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, "workflow.ts");
const outputPath = resolve(__dirname, "workflow.generated.ts");

const source = await readFile(sourcePath, "utf-8");
const { source: generated } = generateWorkflowModule(source, {
  filename: "workflow.ts",
});

await writeFile(outputPath, generated);
console.log("Compiled workflow → workflow.generated.ts");
