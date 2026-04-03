/**
 * Classification of Eval node IDs.
 *
 * See Kernel Specification §1.5.
 *
 * Every Eval.id is classified as STRUCTURAL or EXTERNAL.
 * Classification is fixed at kernel initialization.
 */

/** The structural operation set. */
const STRUCTURAL_IDS = new Set([
  "let",
  "seq",
  "if",
  "while",
  "call",
  "get",
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "add",
  "sub",
  "mul",
  "div",
  "mod",
  "and",
  "or",
  "not",
  "neg",
  "construct",
  "array",
  "concat",
  "throw",
  "concat-arrays",
  "merge-objects",
  "try",
]);

/** Compound external operations — use unquote, not resolve. */
const COMPOUND_EXTERNAL_IDS = new Set([
  "all",
  "race",
  "scope",
  "spawn",
  "join",
  "resource",
  "provide",
  "timebox",
]);

export type Classification = "STRUCTURAL" | "EXTERNAL";

export function classify(id: string): Classification {
  if (STRUCTURAL_IDS.has(id)) return "STRUCTURAL";
  return "EXTERNAL";
}

export function isCompoundExternal(id: string): boolean {
  return COMPOUND_EXTERNAL_IDS.has(id);
}

export function isStructural(id: string): boolean {
  return STRUCTURAL_IDS.has(id);
}
