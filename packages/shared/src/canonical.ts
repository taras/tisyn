/**
 * Canonical JSON encoding per Conformance Suite §4.3.
 *
 * Rules:
 * 1. Lexicographic key order (Unicode code point) at every level
 * 2. No whitespace between tokens
 * 3. Numbers: shortest round-trip form (ECMAScript Number.prototype.toString())
 * 4. Strings: shortest RFC 8259 escapes for control chars, literal UTF-8 for all others
 * 5. No escaping of `/`
 * 6. Non-ASCII MUST NOT use \uXXXX
 *
 * Used for eq comparison, journal comparison, and interoperability testing.
 */

import type { Json } from "./values.js";

/**
 * Produce canonical JSON encoding of a value.
 *
 * Two values are canonically equal iff their canonical encodings
 * produce byte-identical UTF-8 sequences.
 */
export function canonical(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  // Object — sort keys lexicographically
  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => canonicalString(key) + ":" + canonical(value[key]!));
  return "{" + pairs.join(",") + "}";
}

/**
 * Canonical number encoding.
 * Uses ECMAScript Number.prototype.toString() which produces
 * the shortest round-trip form. Negative zero → "0".
 */
function canonicalNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(n);
}

/**
 * Canonical string encoding.
 * Use JSON.stringify which handles RFC 8259 escaping correctly
 * in V8/Node.js — control characters get \uXXXX escapes,
 * non-ASCII gets literal UTF-8, and / is not escaped.
 */
function canonicalString(s: string): string {
  return JSON.stringify(s);
}
