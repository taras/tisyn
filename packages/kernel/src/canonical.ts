import type { Json } from "@tisyn/ir";

export function canonical(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => canonicalString(key) + ":" + canonical(value[key]!));
  return "{" + pairs.join(",") + "}";
}

function canonicalNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(n);
}

// NOTE: Uses JSON.stringify per kernel spec §11.5 pseudocode.
// Conformance suite §3.3 may define stricter rules (literal UTF-8).
// If conformance suite is normative on this point, this function
// needs to be updated. See audit finding E-1.
function canonicalString(s: string): string {
  return JSON.stringify(s);
}
