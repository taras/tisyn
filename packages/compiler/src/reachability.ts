/**
 * Entrypoint reachability and emission ordering.
 *
 * Implements amendment §16.2 (Entrypoint Reachability) and §16.3 (Emission Ordering).
 */

import ts from "typescript";
import type { ModuleInfo } from "./graph.js";
import { CompileError } from "./errors.js";

// ── Symbol identity ──

export interface SymbolId {
  modulePath: string;
  localName: string;
}

function symbolKey(id: SymbolId): string {
  return `${id.modulePath}::${id.localName}`;
}

// ── Reachability result ──

export interface ReachabilityResult {
  /** Entrypoint symbols (exported generators in workflow-implementation modules). */
  entrypoints: SymbolId[];
  /** All symbols in the reachability closure (includes entrypoints). */
  reachable: Set<string>; // keys from symbolKey
  /** Unreachable exported symbols (candidates for W-GRAPH-001). */
  unreachableExports: SymbolId[];
}

/**
 * Compute the transitive closure of call targets starting from entrypoints.
 *
 * Entrypoints are exported generator functions in workflow-implementation modules (ER1).
 * The closure includes all symbols referenced via yield* or direct calls (ER2-ER3).
 */
export function computeReachability(modules: Map<string, ModuleInfo>): ReachabilityResult {
  // ER1: Find entrypoints — exported generators in workflow-implementation modules
  const entrypoints: SymbolId[] = [];
  const allExportedSymbols: SymbolId[] = [];

  for (const [path, mod] of modules) {
    if (mod.category !== "workflow-implementation") {
      continue;
    }

    for (const gen of mod.generators) {
      const exportedAs = findExportedName(gen.name, mod);
      if (exportedAs !== undefined) {
        entrypoints.push({ modulePath: path, localName: gen.name });
      }
    }

    // Track all exported symbols for unreachable warning
    for (const [, localName] of mod.exportMap.local) {
      allExportedSymbols.push({ modulePath: path, localName });
    }
  }

  // ER5: No entrypoints → reject
  if (entrypoints.length === 0) {
    const rootPaths = [...modules.keys()].join(", ");
    throw new CompileError(
      "E-GRAPH-001",
      `No workflow entrypoints found in module graph. At least one module must export a generator function (function*). Roots: ${rootPaths}`,
      1,
      1,
    );
  }

  // ER2-ER3: Build call graph and compute transitive closure
  const reachable = new Set<string>();
  const worklist = entrypoints.map(symbolKey);

  // Seed with entrypoints
  for (const key of worklist) {
    reachable.add(key);
  }

  while (worklist.length > 0) {
    const key = worklist.pop()!;
    const [modulePath, localName] = parseSymbolKey(key);

    const mod = modules.get(modulePath);
    if (!mod) {
      continue;
    }

    // Find the function body for this symbol
    const callTargets = findCallTargets(localName, mod, modules);

    for (const target of callTargets) {
      const targetKey = symbolKey(target);
      if (!reachable.has(targetKey)) {
        reachable.add(targetKey);
        worklist.push(targetKey);
      }
    }
  }

  // ER4: Unreachable exported symbols
  const unreachableExports = allExportedSymbols.filter((id) => !reachable.has(symbolKey(id)));

  return { entrypoints, reachable, unreachableExports };
}

/**
 * Find all call targets referenced from a function body.
 *
 * Scans for:
 * - yield* f(...) → resolves f to a symbol
 * - f(...) → resolves f to a symbol (direct call)
 *
 * Cross-module references are resolved through import/export bindings (ER3).
 */
function findCallTargets(
  localName: string,
  mod: ModuleInfo,
  modules: Map<string, ModuleInfo>,
): SymbolId[] {
  // Find the function body
  const body = findFunctionBody(localName, mod);
  if (!body) {
    return [];
  }

  const targets: SymbolId[] = [];
  const seen = new Set<string>();

  function visitNode(node: ts.Node): void {
    // yield* expr — look at the expression
    if (ts.isYieldExpression(node) && node.asteriskToken && node.expression) {
      const callee = extractCallee(node.expression);
      if (callee) {
        resolveAndAdd(callee);
      }
    }

    // Direct call: f(...)
    if (ts.isCallExpression(node)) {
      const callee = extractDirectCallee(node);
      if (callee) {
        resolveAndAdd(callee);
      }
    }

    ts.forEachChild(node, visitNode);
  }

  function resolveAndAdd(name: string): void {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);

    // Check if it's a local function in this module
    const localFn = findFunctionByName(name, mod);
    if (localFn) {
      targets.push({ modulePath: mod.path, localName: name });
      return;
    }

    // Check if it's imported from another module
    const imp = mod.valueImports.find((v) => v.localName === name);
    if (imp) {
      const targetMod = modules.get(imp.resolvedPath);
      if (targetMod) {
        // E-IMPORT-001: reachable code references a bare/node: external boundary
        if (targetMod.category === "external" && targetMod.provenance === "boundary") {
          throw new CompileError(
            "E-IMPORT-001",
            `Cannot use '${name}' from external module '${imp.fromModule}' in workflow code`,
            imp.line,
            imp.column,
          );
        }

        // E-IMPORT-004: reachable code references a traversed module with no workflow-relevant symbols
        if (targetMod.category === "external" && targetMod.provenance === "traversed") {
          throw new CompileError(
            "E-IMPORT-004",
            `Module '${imp.resolvedPath}' contains no workflow-relevant declarations`,
            imp.line,
            imp.column,
          );
        }

        // Resolve through export map: importedName → localName in target module
        const targetLocalName = resolveExportToLocal(imp.importedName, targetMod);
        if (targetLocalName) {
          targets.push({ modulePath: imp.resolvedPath, localName: targetLocalName });
        }
      }
    }
  }

  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      ts.forEachChild(stmt, visitNode);
    }
  } else {
    // Arrow with expression body
    visitNode(body);
  }

  return targets;
}

/**
 * Extract the callee name from a call expression.
 * Only handles simple identifier calls: f(...) → "f"
 */
function extractDirectCallee(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  return undefined;
}

/**
 * Extract the callee name from a yield* expression.
 * Handles: yield* f(...) → "f"
 */
function extractCallee(expr: ts.Expression): string | undefined {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

function findFunctionBody(name: string, mod: ModuleInfo): ts.Block | ts.Expression | undefined {
  for (const gen of mod.generators) {
    if (gen.name === name) {
      return gen.body;
    }
  }
  for (const fn of mod.nonGeneratorFunctions) {
    if (fn.name === name) {
      return fn.body;
    }
  }
  return undefined;
}

function findFunctionByName(name: string, mod: ModuleInfo): boolean {
  return (
    mod.generators.some((g) => g.name === name) ||
    mod.nonGeneratorFunctions.some((f) => f.name === name) ||
    mod.nonFunctionExports.includes(name)
  );
}

function findExportedName(localName: string, mod: ModuleInfo): string | undefined {
  for (const [exportedName, local] of mod.exportMap.local) {
    if (local === localName) {
      return exportedName;
    }
  }
  return undefined;
}

function resolveExportToLocal(exportedName: string, mod: ModuleInfo): string | undefined {
  return mod.exportMap.local.get(exportedName);
}

function parseSymbolKey(key: string): [string, string] {
  const idx = key.indexOf("::");
  return [key.slice(0, idx), key.slice(idx + 2)];
}

// ── Emission ordering (§16.3) ──

/**
 * Compute topological emission order for compiled bindings.
 *
 * Uses Tarjan's algorithm for SCC detection. Ties within a
 * topological level are broken lexicographically.
 */
export function computeEmitOrder(
  reachable: Set<string>,
  modules: Map<string, ModuleInfo>,
): SymbolId[] {
  // Build adjacency list from reachable symbols
  const adj = new Map<string, string[]>();

  for (const key of reachable) {
    const [modulePath, localName] = parseSymbolKey(key);
    const mod = modules.get(modulePath);
    if (!mod) {
      continue;
    }

    const targets = findCallTargets(localName, mod, modules);
    const targetKeys = targets.map(symbolKey).filter((k) => reachable.has(k));
    adj.set(key, targetKeys);
  }

  // Tarjan's SCC algorithm
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let nextIndex = 0;
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    index.set(v, nextIndex);
    lowlink.set(v, nextIndex);
    nextIndex++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      scc.sort(); // lexicographic within SCC
      sccs.push(scc);
    }
  }

  // Process in lexicographic order for determinism
  const sortedKeys = [...reachable].sort();
  for (const key of sortedKeys) {
    if (!index.has(key)) {
      strongConnect(key);
    }
  }

  // SCCs are in reverse topological order from Tarjan's
  sccs.reverse();

  // Flatten
  const ordered: SymbolId[] = [];
  for (const scc of sccs) {
    for (const key of scc) {
      const [modulePath, localName] = parseSymbolKey(key);
      ordered.push({ modulePath, localName });
    }
  }

  return ordered;
}
