import { STRUCTURAL_IDS, COMPOUND_EXTERNAL_IDS } from "./derived.js";

const STRUCTURAL_SET: ReadonlySet<string> = new Set(STRUCTURAL_IDS);
const COMPOUND_EXTERNAL_SET: ReadonlySet<string> = new Set(COMPOUND_EXTERNAL_IDS);

export function classify(id: string): "structural" | "external" {
  if (STRUCTURAL_SET.has(id)) {
    return "structural";
  }
  return "external";
}

export function isStructural(id: string): boolean {
  return STRUCTURAL_SET.has(id);
}

export function isExternal(id: string): boolean {
  return !STRUCTURAL_SET.has(id);
}

export function isCompoundExternal(id: string): boolean {
  return COMPOUND_EXTERNAL_SET.has(id);
}
