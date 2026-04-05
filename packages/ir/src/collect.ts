import type { TisynExpr } from "./types.js";
import { isEvalNode, isRefNode, isFnNode } from "./guards.js";
import { walk } from "./walk.js";
import { isExternal } from "./classify.js";

export function collectRefs(expr: TisynExpr): string[] {
  const refs: string[] = [];
  walk(expr, {
    enter(node) {
      if (isRefNode(node)) {
        refs.push(node.name);
      }
    },
  });
  return refs;
}

export function collectExternalIds(expr: TisynExpr): string[] {
  const ids: string[] = [];
  walk(expr, {
    enter(node) {
      if (isEvalNode(node) && isExternal(node.id)) {
        ids.push(node.id);
      }
    },
  });
  return ids;
}

export function collectFreeRefs(expr: TisynExpr): string[] {
  const free = collectFreeRefsSet(expr, new Set());
  return [...free];
}

function collectFreeRefsSet(expr: TisynExpr, bound: Set<string>): Set<string> {
  if (expr === null || typeof expr !== "object") {
    return new Set();
  }

  if (Array.isArray(expr)) {
    const result = new Set<string>();
    for (const item of expr) {
      for (const ref of collectFreeRefsSet(item as TisynExpr, bound)) {
        result.add(ref);
      }
    }
    return result;
  }

  if (isRefNode(expr)) {
    if (bound.has(expr.name)) {
      return new Set();
    }
    return new Set([expr.name]);
  }

  if (isFnNode(expr)) {
    const newBound = new Set(bound);
    for (const p of expr.params) {
      newBound.add(p);
    }
    return collectFreeRefsSet(expr.body as TisynExpr, newBound);
  }

  if (isEvalNode(expr)) {
    // Check if this is a structural "let" — it introduces a binding
    if (expr.id === "let") {
      const data = expr.data as Record<string, unknown>;
      const shape =
        data &&
        typeof data === "object" &&
        "tisyn" in data &&
        (data as Record<string, unknown>)["tisyn"] === "quote"
          ? (data as { expr: Record<string, unknown> }).expr
          : data;
      const s = shape as { name: string; value: TisynExpr; body: TisynExpr };
      const valueFree = collectFreeRefsSet(s.value, bound);
      const newBound = new Set(bound);
      newBound.add(s.name);
      const bodyFree = collectFreeRefsSet(s.body, newBound);
      return union(valueFree, bodyFree);
    }

    // For all other eval nodes, recurse into data
    return collectFreeRefsSet(expr.data as TisynExpr, bound);
  }

  if (typeof expr === "object" && "tisyn" in expr) {
    const tisyn = (expr as Record<string, unknown>)["tisyn"];
    if (tisyn === "quote") {
      return collectFreeRefsSet((expr as { expr: TisynExpr }).expr, bound);
    }
  }

  // Plain object — recurse into values
  const result = new Set<string>();
  for (const key of Object.keys(expr)) {
    for (const ref of collectFreeRefsSet(
      (expr as Record<string, TisynExpr>)[key] as TisynExpr,
      bound,
    )) {
      result.add(ref);
    }
  }
  return result;
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set(a);
  for (const item of b) {
    result.add(item);
  }
  return result;
}
