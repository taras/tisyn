import type {
  TisynExpr, EvalNode, QuoteNode, RefNode, FnNode,
} from "./types.js";
import type { StructuralId } from "./derived.js";
import { isEvalNode, isQuoteNode, isRefNode, isFnNode } from "./guards.js";
import { classify } from "./classify.js";

type NodeOfKind<K extends string> =
  K extends "ref" ? RefNode :
  K extends "fn" ? FnNode :
  K extends "eval" ? EvalNode :
  K extends "quote" ? QuoteNode :
  K extends "literal" ? TisynExpr :
  never;

export type Visitor = {
  [K in "ref" | "fn" | "eval" | "quote" | "literal"]?:
    (node: NodeOfKind<K>) => TisynExpr | undefined;
} & {
  [K in StructuralId]?:
    (node: EvalNode) => TisynExpr | undefined;
};

export function transform(expr: TisynExpr, visitor: Visitor): TisynExpr {
  return transformNode(expr, visitor);
}

function transformNode(expr: TisynExpr, visitor: Visitor): TisynExpr {
  // Primitives
  if (expr === null || typeof expr !== "object") {
    if (visitor.literal) {
      const result = visitor.literal(expr);
      if (result !== undefined) return result;
    }
    return expr;
  }

  if (Array.isArray(expr)) {
    if (visitor.literal) {
      const result = visitor.literal(expr as TisynExpr);
      if (result !== undefined) return result;
    }
    return expr.map((e) => transformNode(e as TisynExpr, visitor));
  }

  if (isRefNode(expr)) {
    if (visitor.ref) {
      const result = visitor.ref(expr);
      if (result !== undefined) return result;
    }
    return expr;
  }

  if (isQuoteNode(expr)) {
    if (visitor.quote) {
      const result = visitor.quote(expr);
      if (result !== undefined) return result;
    }
    // Recurse into Quote contents
    const newExpr = transformNode(expr.expr as TisynExpr, visitor);
    if (newExpr === expr.expr) return expr;
    return { tisyn: "quote", expr: newExpr };
  }

  if (isFnNode(expr)) {
    if (visitor.fn) {
      const result = visitor.fn(expr);
      if (result !== undefined) return result;
    }
    const newBody = transformNode(expr.body as TisynExpr, visitor);
    if (newBody === expr.body) return expr;
    return { tisyn: "fn", params: expr.params, body: newBody };
  }

  if (isEvalNode(expr)) {
    // Check for structural ID-specific visitor first
    const structuralVisitor = visitor[expr.id as StructuralId];
    if (structuralVisitor) {
      const result = structuralVisitor(expr);
      if (result !== undefined) return result;
    }

    // Then check generic eval visitor
    if (visitor.eval) {
      const result = visitor.eval(expr);
      if (result !== undefined) return result;
    }

    // Recurse into data
    const cls = classify(expr.id);
    if (cls === "structural") {
      const newData = transformNode(expr.data as TisynExpr, visitor);
      if (newData === expr.data) return expr;
      return { tisyn: "eval", id: expr.id, data: newData };
    }

    // External — recurse into data too (transform follows raw syntax like walk)
    const newData = transformNode(expr.data as TisynExpr, visitor);
    if (newData === expr.data) return expr;
    return { tisyn: "eval", id: expr.id, data: newData };
  }

  // Plain object literal
  if (visitor.literal) {
    const result = visitor.literal(expr as TisynExpr);
    if (result !== undefined) return result;
  }

  const obj = expr as Record<string, TisynExpr>;
  let changed = false;
  const newObj: Record<string, TisynExpr> = {};
  for (const key of Object.keys(obj)) {
    const newVal = transformNode(obj[key] as TisynExpr, visitor);
    if (newVal !== obj[key]) changed = true;
    newObj[key] = newVal;
  }
  return changed ? newObj : expr;
}
