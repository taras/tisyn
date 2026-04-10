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
import type { TisynExpr as Expr } from "@tisyn/ir";
import type { DiscoveredContract } from "./discover.js";
import { buildGraph, type ModuleCategory, type ModuleInfo } from "./graph.js";
import { computeReachability, computeEmitOrder } from "./reachability.js";
import { compileReachableSymbols, type CompiledSymbol } from "./compile-symbols.js";
import { assignEmittedNames, checkNameConflicts, checkContractNameConflicts } from "./naming.js";
import { generateGraphCode } from "./codegen.js";
import { Counter } from "./counter.js";

export type { ModuleCategory } from "./graph.js";

// ── Public types ──

export interface CompileGraphOptions {
  roots: string[];
  readFile?: (path: string) => string;
  validate?: boolean;
  format?: "printed" | "json";
  generatedModulePaths?: string[];
}

export interface CompileGraphResult {
  /** Emitted artifact text. */
  source: string;
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
  modules: Map<string, ModuleInfo>;
  traversalOrder: string[];
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
}): PipelineResult {
  const { roots, readFile, validate = true, format = "printed", generatedModulePaths } = options;

  // Stage 1-3: Build graph, classify modules, extract symbols
  const graph = buildGraph(roots, readFile, generatedModulePaths);

  // Stage 4: Compute reachability and emission order
  const { reachable } = computeReachability(graph.modules);
  const emitOrder = computeEmitOrder(reachable, graph.modules);

  // Stage 5: Compile reachable symbols
  const counter = new Counter();
  const { symbols, discoveredContracts, compiledWorkflows } = compileReachableSymbols(
    graph.modules,
    reachable,
    emitOrder,
    counter,
    { validate },
  );

  // Assign emitted names (§21)
  const modulePaths = [...graph.modules.keys()];
  assignEmittedNames(symbols, modulePaths);

  // Name conflict detection (§19)
  checkNameConflicts(symbols);
  checkContractNameConflicts(discoveredContracts, graph.modules);

  // Collect type imports from across the graph
  const typeImports: string[] = [];
  for (const mod of graph.modules.values()) {
    for (const t of mod.typeImportTexts) {
      if (!typeImports.includes(t)) {
        typeImports.push(t);
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
  for (const [path, names] of referencedFromGenerated) {
    if (names.size > 0) {
      generatedImports.push({ names: [...names], path });
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
    modules: graph.modules,
    traversalOrder: graph.traversalOrder,
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
 * Compile a rooted graph and return per-export IR and input schemas.
 *
 * Used by the CLI's `tsn run` to compile authored .ts sources at runtime
 * without writing a temp artifact file. Returns the compiled IR objects
 * and input schemas directly, avoiding file IO and package resolution issues.
 */
export function compileGraphForRuntime(options: CompileGraphOptions): {
  exports: Record<string, { ir: Expr; inputSchema: import("./codegen.js").InputSchema }>;
} {
  const readFile = options.readFile ?? defaultReadFile;

  const result = runPipeline({
    roots: options.roots,
    readFile,
    validate: options.validate,
    format: options.format,
    generatedModulePaths: options.generatedModulePaths,
  });

  const exports: Record<string, { ir: Expr; inputSchema: import("./codegen.js").InputSchema }> = {};
  for (const sym of result.compiledSymbols) {
    if (sym.isExported) {
      exports[sym.exportedName ?? sym.id.localName] = {
        ir: sym.ir,
        inputSchema: sym.inputSchema,
      };
    }
  }

  return { exports };
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
