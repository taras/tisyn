// Deterministic content hash for normalized modules, per N6 of
// spec-system-specification.source.md §6.2.
//
// Algorithm (D3 of the plan):
//   1. Strip `_hash` and `_normalizedAt` from the top-level object before
//      hashing so the hash does not depend on itself or on wall-clock time.
//   2. Canonical JSON: object keys sorted lexicographically (code-point
//      order); arrays preserve authored order (order is semantic for sections
//      and rules); standard JSON.stringify escaping; no whitespace.
//   3. SHA-256 digest, prefixed with "sha256:".
//
// `node:crypto` is a Node built-in, not a @tisyn/* runtime dep, so the
// zero-runtime-dep constraint is preserved.

import { createHash } from "node:crypto";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean" || t === "number") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  // Upstream serializable-domain enforcement rejects undefined, functions,
  // symbols, bigints, class instances, and non-finite numbers. Reaching here
  // indicates a programming error, not a data error.
  throw new Error(`canonicalize: unsupported value type ${t}`);
}

export function computeHash(authored: Record<string, unknown>): string {
  const stripped: Record<string, unknown> = {};
  for (const key of Object.keys(authored)) {
    if (key === "_hash" || key === "_normalizedAt") continue;
    stripped[key] = authored[key];
  }
  const canonical = canonicalize(stripped);
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${digest}`;
}
