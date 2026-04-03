/**
 * Descriptor and workflow module loading for `tsn run` and `tsn check`.
 *
 * Loads workflow descriptors, resolves workflow modules, and extracts
 * compiled IR exports with input schema metadata.
 */

import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import type { TisynExpr as Expr } from "@tisyn/ir";
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
export async function loadDescriptorModule(modulePath: string): Promise<WorkflowDescriptor> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(3, `Failed to load descriptor module '${modulePath}': ${msg}`);
  }

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
): { modulePath: string; exportName: string } {
  const run = descriptor.run;
  const exportName = run.export;
  const modulePath = run.module ? resolve(dirname(descriptorPath), run.module) : descriptorPath;
  return { modulePath, exportName };
}

/**
 * Load a workflow IR export and optional input schema from a generated module.
 *
 * Exit codes:
 * - 3: module import failure
 * - 2: named export not found or structurally invalid
 */
export async function loadWorkflowExport(
  modulePath: string,
  exportName: string,
): Promise<WorkflowExport> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(3, `Failed to load workflow module '${modulePath}': ${msg}`);
  }

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
