/**
 * Rooted import-graph compilation entry point.
 *
 * Orchestrates the six-stage pipeline:
 *   1. Graph construction (§14)
 *   2. Module classification (§15)
 *   3. Symbol extraction (§16.1)
 *   4. Entrypoint reachability (§16.2)
 *   5. Compilation (§17, §18)
 *   6. Emission (§21, §22)
 */

import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { TisynExpr as Expr } from "@tisyn/ir";
import { collectFreeRefs, isRefNode, isEvalNode, isFnNode, isQuoteNode } from "@tisyn/ir";
import { collectReferencedTypeImports, type DiscoveredContract } from "./discover.js";
import { buildGraph, type ModuleCategory, type ModuleInfo } from "./graph.js";
import { computeReachability, computeEmitOrder } from "./reachability.js";
import { compileReachableSymbols, type CompiledSymbol } from "./compile-symbols.js";
import {
  assignEmittedNames,
  checkNameConflicts,
  checkContractNameConflicts,
  checkContractSymbolConflicts,
} from "./naming.js";
import { generateGraphCode, type InputSchema } from "./codegen.js";
import { Counter } from "./counter.js";
import { CompileError } from "./errors.js";

export type { ModuleCategory } from "./graph.js";

// ── Public types ──

export interface CompileGraphOptions {
  roots: string[];
  readFile?: (path: string) => string;
  validate?: boolean;
  format?: "printed" | "json";
  generatedModulePaths?: string[];
  /** Output file path. Used to emit generated-module imports as relative specifiers. */
  outputPath?: string;
}

/** Options for runtime compilation of a selected workflow export. */
export interface CompileForExecutionOptions extends CompileGraphOptions {
  /** The export name to select for execution. */
  exportName: string;
}

/** Result of compiling a selected workflow for direct execution. */
export interface RuntimeCompilationResult {
  /** The selected workflow's compiled IR, rewritten with globally unique binding names. */
  ir: Expr;
  /** Input schema for the selected workflow. */
  inputSchema: InputSchema;
  /**
   * Runtime binding map for all reachable compiled symbols, including the selected export.
   *
   * Keys are collision-safe runtime names:
   * - Exported symbols: `__rtexport_{emittedName}` (prevents collision with own parameter names)
   * - Non-exported symbols: `__m{idx}_{localName}` (standard mangled emitted name)
   *
   * All keys start with `__`, preventing collisions with user-chosen parameter names.
   * The selected export is included so self-recursive workflows can resolve their own Ref.
   */
  runtimeBindings: Record<string, Expr>;
}

export interface CompileGraphResult {
  /** Emitted artifact text. */
  source: string;
  /** Discovered ambient factory contracts. */
  contracts: DiscoveredContract[];
  /** Compiled workflow IR by exported name. */
  workflows: Record<string, Expr>;
  /** Compiled helper IR by emitted name. */
  helpers: Record<string, Expr>;
  /** Diagnostic warnings (e.g. W-GRAPH-001 for unreachable exports). */
  warnings: string[];
  /** Module graph metadata. */
  graph: {
    /** Module category and participation profile keyed by resolved path. */
    modules: Record<
      string,
      {
        category: ModuleCategory;
        participation?: ("implementation" | "declaration")[];
      }
    >;
    /** Resolved paths of all traversed modules. */
    traversed: string[];
    /** Names of all compiled symbols. */
    compiled: string[];
  };
}

// ── Internal pipeline result ──

interface PipelineResult {
  emittedSource: string;
  compiledSymbols: CompiledSymbol[];
  discoveredContracts: DiscoveredContract[];
  compiledWorkflows: Record<string, Expr>;
  compiledHelpers: Record<string, Expr>;
  warnings: string[];
  modules: Map<string, ModuleInfo>;
  traversalOrder: string[];
  /** Graph-wide reachable symbol keys (modulePath::localName). */
  reachable: Set<string>;
}

/**
 * Run the internal six-stage compilation pipeline.
 *
 * Returns the full internal state needed by both compileGraph (public)
 * and generateWorkflowModule (wrapper).
 */
function runPipeline(options: {
  roots: string[];
  readFile: (path: string) => string;
  validate?: boolean;
  format?: "printed" | "json";
  generatedModulePaths?: string[];
  outputPath?: string;
}): PipelineResult {
  const {
    roots,
    readFile,
    validate = true,
    format = "printed",
    generatedModulePaths,
    outputPath,
  } = options;

  // Stage 1-3: Build graph, classify modules, extract symbols
  const graph = buildGraph(roots, readFile, generatedModulePaths);

  // Stage 4: Compute reachability and emission order
  const { reachable, unreachableExports } = computeReachability(graph.modules);
  const emitOrder = computeEmitOrder(reachable, graph.modules);

  // Collect warnings for unreachable exported symbols (W-GRAPH-001)
  const warnings: string[] = [];
  for (const id of unreachableExports) {
    warnings.push(
      `W-GRAPH-001: Exported symbol '${id.localName}' in '${id.modulePath}' is not reachable from any entrypoint`,
    );
  }

  // Stage 5: Compile reachable symbols
  const counter = new Counter();
  const { symbols, discoveredContracts, compiledWorkflows, compiledHelpers } =
    compileReachableSymbols(graph.modules, reachable, emitOrder, counter, { validate });

  // Stage 5b: Module reclassification (§15.7)
  for (const [, mod] of graph.modules) {
    if (mod.provenance !== "traversed") {
      continue;
    }
    const hasCompiledSymbols = symbols.some((s) => s.id.modulePath === mod.path);

    // MC2/MC8: workflow-implementation with no generators and no compiled symbols → external
    if (
      mod.category === "workflow-implementation" &&
      mod.generators.length === 0 &&
      !hasCompiledSymbols
    ) {
      mod.category = "external";
    }

    // MP2: contract-declaration with compiled non-generator symbols → workflow-implementation
    if (mod.category === "contract-declaration" && hasCompiledSymbols) {
      mod.category = "workflow-implementation";
    }
  }

  // Assign emitted names (§21)
  const modulePaths = [...graph.modules.keys()];
  assignEmittedNames(symbols, modulePaths);

  // Name conflict detection (§19)
  checkNameConflicts(symbols);
  checkContractNameConflicts(discoveredContracts, graph.modules);
  checkContractSymbolConflicts(symbols, discoveredContracts);

  // Collect type imports from across the graph, filtered to only contract-referenced types
  const typeImports: string[] = [];
  for (const mod of graph.modules.values()) {
    if (mod.contractTypeNodes.length > 0) {
      const filtered = collectReferencedTypeImports(mod.sourceFile, mod.contractTypeNodes);
      for (const t of filtered) {
        if (!typeImports.includes(t)) {
          typeImports.push(t);
        }
      }
    }
  }

  // Collect generated-module imports (GM6)
  // Narrow to only names actually referenced across the compilation boundary
  // to avoid pulling in bookkeeping exports (workflows, inputSchemas) that
  // would collide with the current module's own wrapper exports.
  const referencedFromGenerated = new Map<string, Set<string>>();
  for (const mod of graph.modules.values()) {
    if (mod.category === "generated") {
      continue;
    }
    for (const imp of mod.valueImports) {
      const targetMod = graph.modules.get(imp.resolvedPath);
      if (targetMod && targetMod.category === "generated") {
        let names = referencedFromGenerated.get(imp.resolvedPath);
        if (!names) {
          names = new Set();
          referencedFromGenerated.set(imp.resolvedPath, names);
        }
        names.add(imp.importedName);
      }
    }
  }

  const generatedImports: { names: string[]; path: string }[] = [];
  // Derive the directory for relative specifier computation:
  // explicit outputPath > first root's directory as fallback
  const outputDir = outputPath ? dirname(outputPath) : dirname(roots[0]!);
  for (const [absPath, names] of referencedFromGenerated) {
    if (names.size > 0) {
      const rel = relative(outputDir, absPath).split("\\").join("/");
      const specifier = rel.startsWith(".") ? rel : `./${rel}`;
      generatedImports.push({ names: [...names], path: specifier });
    }
  }

  // Stage 6: Generate artifact
  const emittedSource = generateGraphCode({
    symbols,
    contracts: discoveredContracts,
    typeImports,
    generatedImports,
    format,
  });

  return {
    emittedSource,
    compiledSymbols: symbols,
    discoveredContracts,
    compiledWorkflows,
    compiledHelpers,
    warnings,
    modules: graph.modules,
    traversalOrder: graph.traversalOrder,
    reachable,
  };
}

// ── Public entry point ──

/**
 * Compile a rooted import graph to a workflow module artifact.
 *
 * @throws CompileError for graph construction, compilation, or naming errors
 */
export function compileGraph(options: CompileGraphOptions): CompileGraphResult {
  const readFile = options.readFile ?? defaultReadFile;

  const result = runPipeline({
    roots: options.roots,
    readFile,
    validate: options.validate,
    format: options.format,
    generatedModulePaths: options.generatedModulePaths,
    outputPath: options.outputPath,
  });

  // Project internal state to public result
  const modules: CompileGraphResult["graph"]["modules"] = {};
  for (const [path, mod] of result.modules) {
    const participation = computeParticipation(mod, result.compiledSymbols);
    modules[path] = {
      category: mod.category,
      ...(participation.length > 0 ? { participation } : {}),
    };
  }

  return {
    source: result.emittedSource,
    contracts: result.discoveredContracts,
    workflows: result.compiledWorkflows,
    helpers: result.compiledHelpers,
    warnings: result.warnings,
    graph: {
      modules,
      traversed: result.traversalOrder,
      compiled: result.compiledSymbols.map((s) => s.emittedName),
    },
  };
}

// ── Internal: generateWorkflowModule pipeline ──

/**
 * Run the import-graph pipeline for single-source compilation.
 *
 * Used by generateWorkflowModule to delegate to the same pipeline.
 */
export function runSingleSourcePipeline(options: {
  source: string;
  filename?: string;
  validate?: boolean;
  format?: "printed" | "json";
}): {
  emittedSource: string;
  discoveredContracts: DiscoveredContract[];
  compiledWorkflows: Record<string, Expr>;
} {
  const virtualPath = options.filename ?? "input.ts";

  const result = runPipeline({
    roots: [virtualPath],
    readFile: (path: string) => {
      if (path === virtualPath) {
        return options.source;
      }
      throw new Error(`ENOENT: ${path}`);
    },
    validate: options.validate,
    format: options.format,
  });

  return {
    emittedSource: result.emittedSource,
    discoveredContracts: result.discoveredContracts,
    compiledWorkflows: result.compiledWorkflows,
  };
}

/**
 * Compile a rooted graph and return per-export IR, input schema, and runtime bindings.
 *
 * Used by the CLI's `tsn run` to compile authored .ts sources at runtime
 * without writing a temp artifact file. Returns the selected export's compiled IR
 * rewritten with globally unique binding names, plus a runtime binding map
 * for all reachable compiled symbols.
 */
export function compileGraphForRuntime(
  options: CompileForExecutionOptions,
): RuntimeCompilationResult {
  const readFile = options.readFile ?? defaultReadFile;

  const result = runPipeline({
    roots: options.roots,
    readFile,
    validate: options.validate,
    format: options.format,
    generatedModulePaths: options.generatedModulePaths,
  });

  // Find the selected export
  const selectedSymbol = result.compiledSymbols.find(
    (s) => s.isExported && (s.exportedName ?? s.id.localName) === options.exportName,
  );
  if (!selectedSymbol) {
    const available =
      result.compiledSymbols
        .filter((s) => s.isExported)
        .map((s) => s.exportedName ?? s.id.localName)
        .join(", ") || "(none)";
    throw new CompileError(
      "E-GRAPH-002",
      `Workflow source does not export '${options.exportName}'. Exported: ${available}`,
      1,
      1,
    );
  }

  // Build symbol lookup by key
  const symbolByKey = new Map<string, CompiledSymbol>();
  for (const sym of result.compiledSymbols) {
    symbolByKey.set(`${sym.id.modulePath}::${sym.id.localName}`, sym);
  }

  // Step 3: Compute per-export reachability
  const perExportReachable = buildPerExportReachable(selectedSymbol, symbolByKey, result.modules);

  // Step 2: Assign synthetic runtime names
  const runtimeNames = new Map<string, string>();
  for (const key of perExportReachable) {
    const sym = symbolByKey.get(key)!;
    if (sym.isExported) {
      runtimeNames.set(key, `__rtexport_${sym.emittedName}`);
    } else {
      runtimeNames.set(key, sym.emittedName);
    }
  }

  // Step 4: Build per-module name maps
  const moduleNameMaps = buildModuleNameMaps(
    perExportReachable,
    runtimeNames,
    symbolByKey,
    result.modules,
  );

  // Step 5: Rewrite IR and build binding map
  const runtimeBindings: Record<string, Expr> = {};
  let rewrittenSelectedIr: Expr | undefined;

  for (const key of perExportReachable) {
    const sym = symbolByKey.get(key)!;
    const nameMap = moduleNameMaps.get(sym.id.modulePath) ?? {};
    const rewritten = rewriteRefs(sym.ir, nameMap, new Set<string>());
    const rtName = runtimeNames.get(key)!;
    runtimeBindings[rtName] = rewritten;

    if (key === `${selectedSymbol.id.modulePath}::${selectedSymbol.id.localName}`) {
      rewrittenSelectedIr = rewritten;
    }
  }

  return {
    ir: rewrittenSelectedIr!,
    inputSchema: selectedSymbol.inputSchema,
    runtimeBindings,
  };
}

// ── Per-export reachability ──

/**
 * Compute the set of compiled symbol keys reachable from the selected export.
 *
 * Traces through IR free variables and resolves them via module imports
 * and local definitions to find transitively reachable compiled symbols.
 */
function buildPerExportReachable(
  selectedSymbol: CompiledSymbol,
  symbolByKey: Map<string, CompiledSymbol>,
  modules: Map<string, ModuleInfo>,
): Set<string> {
  const selectedKey = `${selectedSymbol.id.modulePath}::${selectedSymbol.id.localName}`;
  const reachable = new Set<string>();
  const worklist = [selectedKey];

  while (worklist.length > 0) {
    const key = worklist.pop()!;
    if (reachable.has(key)) {
      continue;
    }
    reachable.add(key);

    const sym = symbolByKey.get(key);
    if (!sym) {
      continue;
    }

    const freeRefs = collectFreeRefs(sym.ir);
    const mod = modules.get(sym.id.modulePath);
    if (!mod) {
      continue;
    }

    for (const refName of freeRefs) {
      // Check if it's a local compiled symbol
      const localKey = `${sym.id.modulePath}::${refName}`;
      if (symbolByKey.has(localKey)) {
        if (!reachable.has(localKey)) {
          worklist.push(localKey);
        }
        continue;
      }

      // Check if it's an import
      const imp = mod.valueImports.find((v) => v.localName === refName);
      if (imp) {
        const targetMod = modules.get(imp.resolvedPath);
        if (targetMod) {
          const targetLocalName = targetMod.exportMap.local.get(imp.importedName);
          if (targetLocalName) {
            const targetKey = `${imp.resolvedPath}::${targetLocalName}`;
            if (symbolByKey.has(targetKey) && !reachable.has(targetKey)) {
              worklist.push(targetKey);
            }
          }
        }
      }
    }
  }

  return reachable;
}

// ── Per-module name maps ──

/**
 * Build a name map for each module with symbols in the per-export reachable set.
 *
 * Maps source-local identifiers to their globally unique runtime names,
 * so that IR Ref nodes can be rewritten to use collision-safe names.
 */
function buildModuleNameMaps(
  perExportReachable: Set<string>,
  runtimeNames: Map<string, string>,
  symbolByKey: Map<string, CompiledSymbol>,
  modules: Map<string, ModuleInfo>,
): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();

  // Collect all module paths that have reachable symbols
  const modulePaths = new Set<string>();
  for (const key of perExportReachable) {
    const sym = symbolByKey.get(key)!;
    modulePaths.add(sym.id.modulePath);
  }

  for (const modPath of modulePaths) {
    const nameMap: Record<string, string> = {};
    const mod = modules.get(modPath);
    if (!mod) {
      continue;
    }

    // Map local compiled symbols
    for (const key of perExportReachable) {
      const sym = symbolByKey.get(key)!;
      if (sym.id.modulePath === modPath) {
        nameMap[sym.id.localName] = runtimeNames.get(key)!;
      }
    }

    // Map imports that resolve to reachable compiled symbols
    for (const imp of mod.valueImports) {
      const targetMod = modules.get(imp.resolvedPath);
      if (!targetMod) {
        continue;
      }
      const targetLocalName = targetMod.exportMap.local.get(imp.importedName);
      if (targetLocalName) {
        const targetKey = `${imp.resolvedPath}::${targetLocalName}`;
        if (perExportReachable.has(targetKey)) {
          nameMap[imp.localName] = runtimeNames.get(targetKey)!;
        }
      }
    }

    result.set(modPath, nameMap);
  }

  return result;
}

// ── Scope-aware IR Ref rewriting ──

/**
 * Rewrite Ref nodes in an IR tree, replacing source-local names with
 * globally unique runtime names. Scope-aware: respects fn params,
 * let bindings, and try catch params.
 */
function rewriteRefs(expr: Expr, nameMap: Record<string, string>, bound: Set<string>): Expr {
  if (expr === null || typeof expr !== "object") {
    return expr;
  }

  if (Array.isArray(expr)) {
    let changed = false;
    const newArr = expr.map((item) => {
      const rewritten = rewriteRefs(item as Expr, nameMap, bound);
      if (rewritten !== item) {
        changed = true;
      }
      return rewritten;
    });
    return changed ? newArr : expr;
  }

  if (isRefNode(expr)) {
    if (!bound.has(expr.name) && expr.name in nameMap) {
      return { tisyn: "ref", name: nameMap[expr.name]! };
    }
    return expr;
  }

  if (isFnNode(expr)) {
    const newBound = new Set(bound);
    for (const p of expr.params) {
      newBound.add(p);
    }
    const newBody = rewriteRefs(expr.body as Expr, nameMap, newBound);
    if (newBody === expr.body) {
      return expr;
    }
    return { tisyn: "fn", params: expr.params, body: newBody };
  }

  if (isEvalNode(expr)) {
    if (expr.id === "let") {
      const data = expr.data as Record<string, unknown>;
      const shape =
        data &&
        typeof data === "object" &&
        "tisyn" in data &&
        (data as Record<string, unknown>)["tisyn"] === "quote"
          ? (data as { expr: Record<string, unknown> }).expr
          : data;
      const s = shape as { name: string; value: Expr; body: Expr };
      const newValue = rewriteRefs(s.value, nameMap, bound);
      const newBound = new Set(bound);
      newBound.add(s.name);
      const newBody = rewriteRefs(s.body, nameMap, newBound);
      if (newValue === s.value && newBody === s.body) {
        return expr;
      }
      const newShape = { name: s.name, value: newValue, body: newBody };
      if (isQuoteNode(data as Expr)) {
        return {
          tisyn: "eval",
          id: "let",
          data: { tisyn: "quote", expr: newShape },
        } as unknown as Expr;
      }
      return { tisyn: "eval", id: "let", data: newShape } as unknown as Expr;
    }

    if (expr.id === "try") {
      const data = expr.data as Record<string, unknown>;
      const shape =
        data &&
        typeof data === "object" &&
        "tisyn" in data &&
        (data as Record<string, unknown>)["tisyn"] === "quote"
          ? (data as { expr: Record<string, unknown> }).expr
          : data;
      const s = shape as {
        body: Expr;
        catchParam?: string;
        catchBody?: Expr;
        finally?: Expr;
        finallyPayload?: string;
      };
      const newTryBody = rewriteRefs(s.body, nameMap, bound);
      let newCatchBody = s.catchBody;
      if (s.catchBody !== undefined) {
        const catchBound = s.catchParam ? new Set([...bound, s.catchParam]) : bound;
        newCatchBody = rewriteRefs(s.catchBody, nameMap, catchBound);
      }
      const newFinally =
        s.finally !== undefined ? rewriteRefs(s.finally, nameMap, bound) : s.finally;
      if (newTryBody === s.body && newCatchBody === s.catchBody && newFinally === s.finally) {
        return expr;
      }
      const newShape: Record<string, unknown> = { body: newTryBody };
      if (s.catchParam !== undefined) {
        newShape["catchParam"] = s.catchParam;
      }
      if (newCatchBody !== undefined) {
        newShape["catchBody"] = newCatchBody;
      }
      if (newFinally !== undefined) {
        newShape["finally"] = newFinally;
      }
      if (s.finallyPayload !== undefined) {
        newShape["finallyPayload"] = s.finallyPayload;
      }
      if (isQuoteNode(data as Expr)) {
        return {
          tisyn: "eval",
          id: "try",
          data: { tisyn: "quote", expr: newShape },
        } as unknown as Expr;
      }
      return { tisyn: "eval", id: "try", data: newShape } as unknown as Expr;
    }

    // All other eval nodes: recurse into data
    const newData = rewriteRefs(expr.data as Expr, nameMap, bound);
    if (newData === expr.data) {
      return expr;
    }
    return { tisyn: "eval", id: expr.id, data: newData };
  }

  if (typeof expr === "object" && "tisyn" in expr) {
    const tisyn = (expr as Record<string, unknown>)["tisyn"];
    if (tisyn === "quote") {
      const newInner = rewriteRefs((expr as { expr: Expr }).expr, nameMap, bound);
      if (newInner === (expr as { expr: Expr }).expr) {
        return expr;
      }
      return { tisyn: "quote", expr: newInner } as Expr;
    }
  }

  // Plain object — recurse into values
  let changed = false;
  const newObj: Record<string, Expr> = {};
  for (const key of Object.keys(expr)) {
    const val = (expr as Record<string, Expr>)[key] as Expr;
    const newVal = rewriteRefs(val, nameMap, bound);
    if (newVal !== val) {
      changed = true;
    }
    newObj[key] = newVal;
  }
  return changed ? newObj : expr;
}

// ── Participation profiles (§15.7) ──

function computeParticipation(
  mod: ModuleInfo,
  compiledSymbols: CompiledSymbol[],
): ("implementation" | "declaration")[] {
  if (mod.category === "generated" || mod.category === "type-only" || mod.category === "external") {
    return [];
  }

  const participation: ("implementation" | "declaration")[] = [];

  // Check if module contributes compiled Fn bindings
  const hasCompiledBindings = compiledSymbols.some((s) => s.id.modulePath === mod.path);
  if (hasCompiledBindings) {
    participation.push("implementation");
  }

  // Check if module contributes contract declarations
  if (mod.discoveredContracts.length > 0) {
    participation.push("declaration");
  }

  return participation;
}

// ── Default readFile ──

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf-8");
}
