/**
 * Generate a workflow module from authored source.
 *
 * Orchestrates: Discover → Parse → Compile (contract-aware) → Codegen.
 *
 * Input: a TypeScript source file containing ambient factory contract
 * declarations and exported workflow generator functions.
 *
 * Output: generated TypeScript module source with agent declarations,
 * compiled workflow IR, and grouped exports.
 */

import ts from "typescript";
import type { TisynExpr as Expr } from "@tisyn/ir";
import { assertValidIr } from "@tisyn/validate";
import { parseSource } from "./parse.js";
import { emitBlock, createContext } from "./emit.js";
import { Fn } from "./ir-builders.js";
import { CompileError } from "./errors.js";
import {
  discoverContracts,
  collectReferencedTypeImports,
  type DiscoveredContract,
} from "./discover.js";
import { generateCode } from "./codegen.js";

export interface GenerateOptions {
  /** Source filename for error messages. */
  filename?: string;
  /** Run IR validation on output. Default: true. */
  validate?: boolean;
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
 * @throws CompileError for contract/workflow mismatches or compilation errors
 */
export function generateWorkflowModule(
  source: string,
  options: GenerateOptions = {},
): GenerateResult {
  const { validate: shouldValidate = true, filename = "input.ts" } = options;

  // Parse source file
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Discover ambient factory contracts
  const contracts = discoverContracts(sourceFile);

  // Build contracts map for emit context
  const contractsMap = new Map<string, DiscoveredContract>();
  for (const contract of contracts) {
    contractsMap.set(contract.name, contract);
  }

  // Parse workflow generator functions (filter to exported)
  const allFunctions = parseSource(source, filename);
  const exportedFunctions = allFunctions.filter((fn) => {
    return fn.node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  });

  if (exportedFunctions.length === 0 && contracts.length === 0) {
    throw new CompileError(
      "E999",
      "No exported workflows or ambient contracts found in source",
      1,
      1,
    );
  }

  // Compile each workflow with contract-aware emit context
  const workflows: Record<string, Expr> = {};

  for (const fn of exportedFunctions) {
    const ctx = createContext(sourceFile, contractsMap);
    const body = emitBlock(fn.body.statements, ctx);
    const irFn = Fn(fn.params, body);

    if (shouldValidate) {
      try {
        assertValidIr(irFn);
      } catch (err) {
        if (err instanceof Error && err.name === "MalformedIR") {
          throw new CompileError(
            "V001",
            `Validation failed for workflow '${fn.name}': ${err.message}`,
            1,
            1,
          );
        }
        throw err;
      }
    }

    workflows[fn.name] = irFn;
  }

  // Collect referenced type imports
  const typeImports = collectReferencedTypeImports(sourceFile, contracts);

  // Generate TypeScript module source
  const generatedSource = generateCode(contracts, workflows, typeImports);

  return {
    source: generatedSource,
    contracts,
    workflows,
  };
}
