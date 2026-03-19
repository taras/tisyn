/**
 * Tisyn IR node types.
 *
 * Five node types discriminated by the `tisyn` field:
 *   Eval, Quote, Ref, Fn, and Literal (anything else).
 *
 * See Tisyn System Specification §3.
 */

import type { Json } from "./values.js";

// ── Node types ──

export interface EvalNode {
  tisyn: "eval";
  id: string;
  data: Expr;
}

export interface QuoteNode {
  tisyn: "quote";
  expr: Expr;
}

export interface RefNode {
  tisyn: "ref";
  name: string;
}

export interface FnNode {
  tisyn: "fn";
  params: string[];
  body: Expr;
}

/**
 * A Literal is any JSON value that either lacks a `tisyn` field
 * or has a `tisyn` field not matching any discriminant.
 *
 * In TypeScript, we represent this as Json — the runtime classifier
 * determines whether a value is an IR node or a literal.
 */
export type Literal = Json;

/** Union of all IR node types. */
export type Expr = EvalNode | QuoteNode | RefNode | FnNode | Literal;

// ── Discriminants ──

const IR_DISCRIMINANTS = new Set(["eval", "quote", "ref", "fn"]);

// ── Type guards ──

/** Check if a value is an object (non-null, non-array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEvalNode(expr: unknown): expr is EvalNode {
  return isPlainObject(expr) && expr["tisyn"] === "eval";
}

export function isQuoteNode(expr: unknown): expr is QuoteNode {
  return isPlainObject(expr) && expr["tisyn"] === "quote";
}

export function isRefNode(expr: unknown): expr is RefNode {
  return isPlainObject(expr) && expr["tisyn"] === "ref";
}

export function isFnNode(expr: unknown): expr is FnNode {
  return isPlainObject(expr) && expr["tisyn"] === "fn";
}

/**
 * Returns true if a value is a Literal (not an IR node).
 *
 * A Literal is any value that either:
 * - is not a plain object, OR
 * - is a plain object without a `tisyn` field matching a discriminant
 */
export function isLiteral(expr: unknown): boolean {
  if (!isPlainObject(expr)) return true;
  const tisyn = expr["tisyn"];
  if (typeof tisyn !== "string") return true;
  return !IR_DISCRIMINANTS.has(tisyn);
}

/**
 * Classify a node for validation purposes.
 *
 * Returns the node type string or "literal".
 * Returns "malformed" if the tisyn field matches a discriminant
 * but required fields are missing or wrong type — per System Spec §10.2,
 * malformed nodes are errors, never treated as Literals.
 */
export type NodeClassification = "eval" | "quote" | "ref" | "fn" | "literal" | "malformed";

export function classifyNode(value: unknown): NodeClassification {
  if (!isPlainObject(value)) return "literal";

  const tisyn = value["tisyn"];
  if (typeof tisyn !== "string" || !IR_DISCRIMINANTS.has(tisyn)) {
    return "literal";
  }

  switch (tisyn) {
    case "eval":
      if (typeof value["id"] !== "string" || !("data" in value)) return "malformed";
      return "eval";
    case "quote":
      if (!("expr" in value)) return "malformed";
      return "quote";
    case "ref":
      if (typeof value["name"] !== "string" || value["name"] === "") return "malformed";
      return "ref";
    case "fn": {
      const params = value["params"];
      if (!Array.isArray(params)) return "malformed";
      for (const p of params) {
        if (typeof p !== "string" || p === "") return "malformed";
      }
      // Check for duplicates
      if (new Set(params).size !== params.length) return "malformed";
      if (!("body" in value)) return "malformed";
      return "fn";
    }
    default:
      return "literal";
  }
}
