/**
 * Emitted naming for compiled symbols.
 *
 * Implements amendment §21 (Emitted Naming) and §19 (Name Conflict Resolution).
 */

import type { CompiledSymbol } from "./compile-symbols.js";
import type { DiscoveredContract } from "./discover.js";
import { CompileError } from "./errors.js";

// ── Emitted naming (§21) ──

/**
 * Assign emitted names to all compiled symbols.
 *
 * §21.1: Exported symbols use their source name.
 * §21.2: Non-exported symbols get module-scoped names satisfying EN1-EN4.
 *
 * The scheme for non-exported symbols is: `__m${moduleIndex}_${localName}`
 * where moduleIndex is the module's position in lexicographic ordering.
 */
export function assignEmittedNames(symbols: CompiledSymbol[], modulePaths: string[]): void {
  // Build module index map: path → lexicographic position
  const sorted = [...modulePaths].sort();
  const moduleIndex = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    moduleIndex.set(sorted[i]!, i);
  }

  for (const symbol of symbols) {
    if (symbol.isExported) {
      // §21.1: Exported symbols use source name
      symbol.emittedName = symbol.exportedName ?? symbol.id.localName;
    } else {
      // §21.2: Non-exported → module-scoped name
      const idx = moduleIndex.get(symbol.id.modulePath) ?? 0;
      symbol.emittedName = `__m${idx}_${symbol.id.localName}`;
    }
  }
}

// ── Name conflict detection (§19) ──

/**
 * Check for duplicate exported symbol names across modules.
 *
 * NC1: Two modules exporting same-named reachable compilable symbol → E-NAME-001.
 * NC2: Diagnostic lists both modules.
 * NC3: No implicit renaming.
 */
export function checkNameConflicts(symbols: CompiledSymbol[]): void {
  // Only exported symbols participate in conflict detection (§19.2)
  const exported = symbols.filter((s) => s.isExported);

  const byName = new Map<string, CompiledSymbol[]>();
  for (const sym of exported) {
    const name = sym.exportedName ?? sym.id.localName;
    const existing = byName.get(name);
    if (existing) {
      existing.push(sym);
    } else {
      byName.set(name, [sym]);
    }
  }

  for (const [name, syms] of byName) {
    if (syms.length > 1) {
      const locations = syms.map((s) => `'${s.id.modulePath}'`).join(" and ");
      throw new CompileError(
        "E-NAME-001",
        `Duplicate exported symbol '${name}' in modules ${locations}`,
        1,
        1,
      );
    }
  }
}

/**
 * Check for duplicate contract names across modules.
 *
 * §19.3: Two modules exporting same-named contract → E-NAME-001.
 */
export function checkContractNameConflicts(
  contracts: DiscoveredContract[],
  modules: Map<string, { discoveredContracts: DiscoveredContract[]; path: string }>,
): void {
  // Build map: contract name → declaring module paths
  const byName = new Map<string, string[]>();

  for (const [path, mod] of modules) {
    for (const c of mod.discoveredContracts) {
      const existing = byName.get(c.name);
      if (existing) {
        existing.push(path);
      } else {
        byName.set(c.name, [path]);
      }
    }
  }

  for (const [name, paths] of byName) {
    if (paths.length > 1) {
      const locations = paths.map((p) => `'${p}'`).join(" and ");
      throw new CompileError(
        "E-NAME-001",
        `Duplicate contract declaration '${name}' in modules ${locations}`,
        1,
        1,
      );
    }
  }
}

/**
 * Check for name collisions between compiled workflow symbols and contract declarations.
 */
export function checkContractSymbolConflicts(
  symbols: CompiledSymbol[],
  contracts: DiscoveredContract[],
): void {
  const contractNames = new Set(contracts.map((c) => c.name));
  for (const sym of symbols) {
    if (sym.isExported) {
      const name = sym.exportedName ?? sym.id.localName;
      if (contractNames.has(name)) {
        throw new CompileError(
          "E-NAME-001",
          `Workflow name '${name}' collides with contract name '${name}'`,
          1,
          1,
        );
      }
    }
  }
}
