/**
 * Stage 5: Compile reachable symbols to IR.
 *
 * Implements amendment §17 (Helper Compilation Semantics) and §18 (Contract Visibility).
 */

import ts from "typescript";
import type { TisynExpr as Expr } from "@tisyn/ir";
import { assertValidIr } from "@tisyn/validate";
import { emitBlock, emitExpression, createStrictContext } from "./emit.js";
import { Fn } from "./ir-builders.js";
import { Counter } from "./counter.js";
import { CompileError } from "./errors.js";
import { getLocation } from "./parse.js";
import type { DiscoveredContract } from "./discover.js";
import type { ModuleInfo } from "./graph.js";
import type { SymbolId } from "./reachability.js";
import { buildInputSchema, type InputSchema } from "./codegen.js";

// ── Compiled symbol ──

export interface CompiledSymbol {
  id: SymbolId;
  emittedName: string;
  ir: Expr;
  isExported: boolean;
  exportedName?: string;
  isGenerator: boolean;
  paramTypes: string[];
  returnType: string;
  inputSchema: InputSchema;
}

export interface CompilationResult {
  symbols: CompiledSymbol[];
  discoveredContracts: DiscoveredContract[];
  compiledWorkflows: Record<string, Expr>;
  compiledHelpers: Record<string, Expr>;
}

/**
 * Compile all reachable symbols in emission order.
 *
 * Uses a single shared Counter across the entire compilation for determinism.
 * Builds per-module contract maps for import-scoped contract visibility (§18).
 */
export function compileReachableSymbols(
  modules: Map<string, ModuleInfo>,
  reachable: Set<string>,
  emitOrder: SymbolId[],
  counter: Counter,
  options: { validate?: boolean },
): CompilationResult {
  const shouldValidate = options.validate ?? true;

  // Build per-module contract maps (§18.2)
  const contractMaps = buildPerModuleContractMaps(modules);

  // Collect all discovered contracts across the graph
  const allContracts: DiscoveredContract[] = [];
  for (const mod of modules.values()) {
    for (const c of mod.discoveredContracts) {
      if (!allContracts.some((existing) => existing.name === c.name)) {
        allContracts.push(c);
      }
    }
  }

  const symbols: CompiledSymbol[] = [];
  const compiledWorkflows: Record<string, Expr> = {};
  const compiledHelpers: Record<string, Expr> = {};

  for (const id of emitOrder) {
    const key = `${id.modulePath}::${id.localName}`;
    if (!reachable.has(key)) continue;

    const mod = modules.get(id.modulePath);
    if (!mod) continue;

    const contractMap = contractMaps.get(id.modulePath) ?? new Map();

    // Find the function
    const generator = mod.generators.find((g) => g.name === id.localName);
    const nonGenerator = mod.nonGeneratorFunctions.find((f) => f.name === id.localName);

    if (!generator && !nonGenerator) continue;

    const isGenerator = !!generator;
    const fn = generator ?? nonGenerator!;

    // Find export name
    let isExported = false;
    let exportedName: string | undefined;
    for (const [eName, lName] of mod.exportMap.local) {
      if (lName === id.localName) {
        isExported = true;
        exportedName = eName;
        break;
      }
    }

    // Create emit context with per-module contracts and shared counter
    const ctx = createStrictContextWithCounter(
      mod.sourceFile,
      contractMap,
      counter,
    );

    let ir: Expr;
    try {
      if (isGenerator) {
        // HC1: Generator → compile via existing pipeline
        ir = emitBlock(generator!.body.statements, ctx);
      } else {
        // HC2: Non-generator → compile body
        const body = nonGenerator!.body;
        if (ts.isBlock(body)) {
          ir = emitBlock(body.statements, ctx);
        } else {
          // Arrow with expression body
          ir = emitExpression(body, ctx);
        }
      }
    } catch (err) {
      if (err instanceof CompileError) {
        // HC3: If compilation fails, report E-HELPER-001
        if (!isGenerator) {
          throw new CompileError(
            "E-HELPER-001",
            `Cannot compile helper '${id.localName}' in '${id.modulePath}': ${err.message}`,
            err.line,
            err.column,
          );
        }
      }
      throw err;
    }

    // Wrap in Fn node
    const params = isGenerator ? generator!.params : nonGenerator!.params;
    const paramTypes = isGenerator ? generator!.paramTypes : nonGenerator!.paramTypes;
    const returnType = isGenerator ? generator!.returnType : "unknown";

    const irFn = Fn(params, ir);

    // Validate
    if (shouldValidate) {
      try {
        assertValidIr(irFn);
      } catch (err) {
        if (err instanceof Error && err.name === "MalformedIR") {
          throw new CompileError(
            "V001",
            `Validation failed for '${id.localName}' in '${id.modulePath}': ${err.message}`,
            1,
            1,
          );
        }
        throw err;
      }
    }

    // The emitted name will be assigned later by the naming module
    const emittedName = exportedName ?? id.localName;

    const symbol: CompiledSymbol = {
      id,
      emittedName,
      ir: irFn,
      isExported,
      exportedName,
      isGenerator,
      paramTypes,
      returnType,
      inputSchema: buildInputSchema(paramTypes),
    };

    symbols.push(symbol);

    if (isExported && isGenerator) {
      compiledWorkflows[exportedName ?? id.localName] = irFn;
    } else {
      compiledHelpers[emittedName] = irFn;
    }
  }

  return { symbols, discoveredContracts: allContracts, compiledWorkflows, compiledHelpers };
}

// ── Per-module contract maps (§18) ──

/**
 * Build per-module contract maps implementing import-scoped visibility.
 *
 * CV1: A contract is in scope in module M if declared in M.
 * CV2: A contract is in scope in module M if M imports it from another module.
 * CV3: No ambient global visibility.
 */
function buildPerModuleContractMaps(
  modules: Map<string, ModuleInfo>,
): Map<string, Map<string, DiscoveredContract>> {
  const result = new Map<string, Map<string, DiscoveredContract>>();

  for (const [path, mod] of modules) {
    const contractMap = new Map<string, DiscoveredContract>();

    // CV1: Contracts declared in this module
    for (const contract of mod.discoveredContracts) {
      contractMap.set(contract.name, contract);
    }

    // CV2: Contracts imported from other modules
    for (const imp of mod.valueImports) {
      const targetMod = modules.get(imp.resolvedPath);
      if (!targetMod) continue;

      // Check if the imported name is a contract in the target module
      const targetContract = targetMod.discoveredContracts.find((c) => {
        // Check if the contract is exported under the imported name
        const exportedLocal = targetMod.exportMap.local.get(imp.importedName);
        return exportedLocal === c.name || c.name === imp.importedName;
      });

      if (targetContract) {
        contractMap.set(imp.localName, targetContract);
      }
    }

    result.set(path, contractMap);
  }

  return result;
}

/**
 * Create a strict emit context with an externally-provided counter.
 *
 * This is like createStrictContext but uses a shared counter for
 * deterministic naming across the entire compilation graph.
 */
function createStrictContextWithCounter(
  sourceFile: ts.SourceFile,
  contracts: Map<string, DiscoveredContract>,
  counter: Counter,
): ReturnType<typeof createStrictContext> {
  // createStrictContext creates its own counter, but we need to share one.
  // We create the context and then replace the counter.
  const ctx = createStrictContext(sourceFile, contracts);
  // The counter field is on the EmitContext interface. Since createStrictContext
  // returns an object matching that interface, we can override it.
  (ctx as { counter: Counter }).counter = counter;
  return ctx;
}
