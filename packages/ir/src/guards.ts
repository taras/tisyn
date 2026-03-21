import type { EvalNode, QuoteNode, RefNode, FnNode, TisynExpr } from "./types.js";

const IR_DISCRIMINANTS = new Set(["eval", "quote", "ref", "fn"]);

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

export function isLiteral(expr: unknown): boolean {
  if (!isPlainObject(expr)) return true;
  const tisyn = expr["tisyn"];
  if (typeof tisyn !== "string") return true;
  return !IR_DISCRIMINANTS.has(tisyn);
}

export function isTaggedNode(expr: unknown): expr is EvalNode | QuoteNode | RefNode | FnNode {
  return (
    isPlainObject(expr) && typeof expr["tisyn"] === "string" && IR_DISCRIMINANTS.has(expr["tisyn"])
  );
}

export type NodeClassification = "eval" | "quote" | "ref" | "fn" | "literal" | "malformed";

export function classifyNode(value: unknown): NodeClassification {
  if (!isPlainObject(value)) return "literal";

  const tisyn = value["tisyn"];
  if (typeof tisyn !== "string" || !IR_DISCRIMINANTS.has(tisyn)) {
    return "literal";
  }

  switch (tisyn) {
    case "eval":
      if (typeof value["id"] !== "string" || value["id"] === "" || !("data" in value))
        return "malformed";
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
      if (new Set(params).size !== params.length) return "malformed";
      if (!("body" in value)) return "malformed";
      return "fn";
    }
    default:
      return "literal";
  }
}

export function isTisynObject(value: unknown): value is Record<string, TisynExpr> {
  return isPlainObject(value);
}
