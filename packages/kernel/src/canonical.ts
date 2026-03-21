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

function canonicalString(s: string): string {
  return JSON.stringify(s);
}
