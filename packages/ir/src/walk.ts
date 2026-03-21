import type { TisynExpr } from "./types.js";
import { isEvalNode, isQuoteNode, isRefNode, isFnNode } from "./guards.js";

export type Walker = {
  enter?: (node: TisynExpr, path: string[]) => void;
  leave?: (node: TisynExpr, path: string[]) => void;
};

export function walk(expr: TisynExpr, walker: Walker): void {
  walkNode(expr, walker, []);
}

function walkNode(expr: TisynExpr, walker: Walker, path: string[]): void {
  walker.enter?.(expr, path);

  if (expr === null || typeof expr !== "object") {
    // Primitive literal — no children
  } else if (Array.isArray(expr)) {
    for (let i = 0; i < expr.length; i++) {
      walkNode(expr[i] as TisynExpr, walker, [...path, String(i)]);
    }
  } else if (isEvalNode(expr)) {
    walkNode(expr.data as TisynExpr, walker, [...path, "data"]);
  } else if (isQuoteNode(expr)) {
    walkNode(expr.expr as TisynExpr, walker, [...path, "expr"]);
  } else if (isRefNode(expr)) {
    // Ref has no children to walk
  } else if (isFnNode(expr)) {
    walkNode(expr.body as TisynExpr, walker, [...path, "body"]);
  } else {
    // Plain object literal — walk values
    const obj = expr as Record<string, TisynExpr>;
    for (const key of Object.keys(obj)) {
      walkNode(obj[key] as TisynExpr, walker, [...path, key]);
    }
  }

  walker.leave?.(expr, path);
}
