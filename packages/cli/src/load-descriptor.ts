/**
 * Descriptor and workflow module loading for `tsn run` and `tsn check`.
 *
 * Loads workflow descriptors, resolves workflow modules, and extracts
 * compiled IR exports with input schema metadata.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { call } from "effection";
import type { Operation } from "effection";
import { loadModule } from "./load-module.js";
import type { TisynExpr as Expr } from "@tisyn/ir";
import { compile } from "@tisyn/compiler";
import type { InputSchema } from "@tisyn/compiler";
import type { WorkflowDescriptor } from "@tisyn/config";

export interface WorkflowExport {
  ir: Expr;
  inputSchema?: InputSchema;
}

/**
 * Dynamically import a module and extract its default export as a WorkflowDescriptor.
 *
 * Exit codes:
 * - 3: module not found / import error
 * - 2: no default export or not a valid WorkflowDescriptor
 */
export function* loadDescriptorModule(modulePath: string): Operation<WorkflowDescriptor> {
  const mod = yield* loadModule(modulePath);

  const descriptor = mod.default;
  if (!descriptor || typeof descriptor !== "object") {
    throw new CliError(2, `Module '${modulePath}' has no default export`);
  }

  if ((descriptor as Record<string, unknown>).tisyn_config !== "workflow") {
    throw new CliError(
      2,
      `Default export of '${modulePath}' is not a WorkflowDescriptor (missing tisyn_config: "workflow")`,
    );
  }

  return descriptor as WorkflowDescriptor;
}

/**
 * Resolve the workflow module path and export name from a descriptor.
 *
 * `run` is a WorkflowRef: `{ export, module? }`.
 * If `module` is present, resolve it relative to the descriptor path.
 * Otherwise, the descriptor module itself contains the workflow export.
 */
export function resolveWorkflowModule(
  descriptor: WorkflowDescriptor,
  descriptorPath: string,
): { modulePath: string; exportName: string; explicit: boolean } {
  const run = descriptor.run;
  const exportName = run.export;
  const explicit = !!run.module;
  const modulePath = run.module ? resolve(dirname(descriptorPath), run.module) : descriptorPath;
  return { modulePath, exportName, explicit };
}

/**
 * Load a workflow IR export and optional input schema from a generated module.
 *
 * Exit codes:
 * - 3: module import failure
 * - 2: named export not found or structurally invalid
 */
export function* loadWorkflowExport(
  modulePath: string,
  exportName: string,
): Operation<WorkflowExport> {
  const mod = yield* loadModule(modulePath);

  const ir = mod[exportName];
  if (!ir || typeof ir !== "object") {
    throw new CliError(2, `Workflow module '${modulePath}' does not export '${exportName}'`);
  }

  if (
    (ir as Record<string, unknown>).tisyn !== "fn" &&
    (ir as Record<string, unknown>).tisyn !== "eval"
  ) {
    throw new CliError(2, `Export '${exportName}' in '${modulePath}' is not a valid Tisyn IR node`);
  }

  // Attempt to load input schema metadata
  let inputSchema: InputSchema | undefined;
  const inputSchemas = mod.inputSchemas as Record<string, InputSchema> | undefined;
  if (inputSchemas && typeof inputSchemas === "object" && exportName in inputSchemas) {
    inputSchema = inputSchemas[exportName];
  }

  return { ir: ir as Expr, inputSchema };
}

/**
 * Compile a TypeScript workflow source file and extract a named export's IR
 * and input schema metadata.
 *
 * Used when run.module points to a .ts source file instead of pre-compiled JS.
 *
 * Exit codes:
 * - 3: source file not found / read error
 * - 1: compilation error
 * - 2: named export not found in compiled result
 */
export function* compileWorkflowFromSource(
  sourcePath: string,
  exportName: string,
): Operation<WorkflowExport> {
  let source: string;
  try {
    source = yield* call(() => readFile(sourcePath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(3, `Failed to read workflow source '${sourcePath}': ${msg}`);
  }

  let result;
  try {
    result = compile(source, { filename: sourcePath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(1, `Failed to compile workflow source '${sourcePath}': ${msg}`);
  }

  // Resolve exported name → local function name (mirrors JS module semantics)
  const localName = result.exports[exportName];
  if (localName === undefined) {
    // Distinguish re-exports from truly missing exports
    if (result.reExports.includes(exportName)) {
      throw new CliError(
        2,
        `'${exportName}' in '${sourcePath}' is re-exported from another module. The .ts runtime-compile path only supports exports defined in the source file.`,
      );
    }
    const available = Object.keys(result.exports).join(", ") || "(none)";
    throw new CliError(
      2,
      `Workflow source '${sourcePath}' does not export '${exportName}'. Exported: ${available}`,
    );
  }

  const ir = result.functions[localName];
  if (!ir) {
    throw new CliError(
      2,
      `Workflow source '${sourcePath}' does not contain compiled function '${localName}'.`,
    );
  }

  const inputSchema = result.inputSchemas[localName];
  return { ir, inputSchema };
}

/**
 * CLI-specific error with an exit code.
 */
export class CliError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
