/**
 * Generate a workflow module from authored source.
 *
 * Thin wrapper around the rooted import-graph pipeline for single-source
 * compilation. All compilation logic lives in compile-graph.ts.
 */

import type { TisynExpr as Expr } from "@tisyn/ir";
import type { DiscoveredContract } from "./discover.js";
import { runSingleSourcePipeline } from "./compile-graph.js";

export interface GenerateOptions {
  /** Source filename for error messages. */
  filename?: string;
  /** Run IR validation on output. Default: true. */
  validate?: boolean;
  /** Workflow export format. "printed" emits constructor-form IR, "json" emits JSON object literals. Default: "printed". */
  workflowFormat?: "printed" | "json";
}

export interface GenerateResult {
  /** Generated TypeScript module source. */
  source: string;
  /** Discovered ambient factory contracts. */
  contracts: DiscoveredContract[];
  /** Compiled workflow IR by function name. */
  workflows: Record<string, Expr>;
}

/**
 * Generate a workflow module from authored source containing ambient
 * factory contracts and exported workflow generator functions.
 *
 * Delegates to the rooted import-graph pipeline via runSingleSourcePipeline.
 *
 * @throws CompileError for contract/workflow mismatches or compilation errors
 */
export function generateWorkflowModule(
  source: string,
  options: GenerateOptions = {},
): GenerateResult {
  const result = runSingleSourcePipeline({
    source,
    filename: options.filename,
    validate: options.validate,
    format: options.workflowFormat,
  });

  return {
    source: result.emittedSource,
    contracts: result.discoveredContracts,
    workflows: result.compiledWorkflows,
  };
}
