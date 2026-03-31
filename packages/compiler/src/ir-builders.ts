/**
 * Pure IR node constructors.
 *
 * Each function produces a valid Tisyn IR node.
 * No logic, no validation — just shape construction.
 *
 * Structural operations wrap data in Quote (Q).
 * External operations leave data unquoted.
 */

import type { TisynExpr as Expr, EvalNode, QuoteNode, RefNode, FnNode } from "@tisyn/ir";

// ── Quote ──

export function Q(expr: unknown): QuoteNode {
  return { tisyn: "quote", expr: expr as Expr };
}

// ── References ──

export function Ref(name: string): RefNode {
  return { tisyn: "ref", name };
}

// ── Functions ──

export function Fn(params: string[], body: Expr): FnNode {
  return { tisyn: "fn", params, body };
}

// ── Structural operations (quoted data) ──

export function Let(name: string, value: Expr, body: Expr): EvalNode {
  return { tisyn: "eval", id: "let", data: Q({ name, value, body }) };
}

export function Seq(exprs: Expr[]): EvalNode {
  return { tisyn: "eval", id: "seq", data: Q({ exprs }) };
}

export function If(condition: Expr, thenBranch: Expr, elseBranch?: Expr): EvalNode {
  const fields: Record<string, unknown> = { condition, then: thenBranch };
  if (elseBranch !== undefined) {
    fields["else"] = elseBranch;
  }
  return { tisyn: "eval", id: "if", data: Q(fields) };
}

export function While(condition: Expr, exprs: Expr[]): EvalNode {
  return { tisyn: "eval", id: "while", data: Q({ condition, exprs }) };
}

export function Call(fn: Expr, args: Expr[]): EvalNode {
  return { tisyn: "eval", id: "call", data: Q({ fn, args }) };
}

export function Get(obj: Expr, key: string): EvalNode {
  return { tisyn: "eval", id: "get", data: Q({ obj, key }) };
}

// ── Binary arithmetic (quoted data) ──

export function Add(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "add", data: Q({ a, b }) };
}

export function Sub(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "sub", data: Q({ a, b }) };
}

export function Mul(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "mul", data: Q({ a, b }) };
}

export function Div(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "div", data: Q({ a, b }) };
}

export function Mod(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "mod", data: Q({ a, b }) };
}

// ── Comparison (quoted data) ──

export function Gt(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "gt", data: Q({ a, b }) };
}

export function Gte(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "gte", data: Q({ a, b }) };
}

export function Lt(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "lt", data: Q({ a, b }) };
}

export function Lte(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "lte", data: Q({ a, b }) };
}

// ── Equality (quoted data) ──

export function Eq(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "eq", data: Q({ a, b }) };
}

export function Neq(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "neq", data: Q({ a, b }) };
}

// ── Logical (quoted data) ──

export function And(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "and", data: Q({ a, b }) };
}

export function Or(a: Expr, b: Expr): EvalNode {
  return { tisyn: "eval", id: "or", data: Q({ a, b }) };
}

export function Not(a: Expr): EvalNode {
  return { tisyn: "eval", id: "not", data: Q({ a }) };
}

// ── Unary ──

export function Neg(a: Expr): EvalNode {
  return { tisyn: "eval", id: "neg", data: Q({ a }) };
}

// ── Construct / Array / Concat ──

export function Construct(fields: Record<string, Expr>): EvalNode {
  return { tisyn: "eval", id: "construct", data: Q(fields) };
}

export function ArrayNode(items: Expr[]): EvalNode {
  return { tisyn: "eval", id: "array", data: Q({ items }) };
}

export function Concat(parts: Expr[]): EvalNode {
  return { tisyn: "eval", id: "concat", data: Q({ parts }) };
}

// ── Throw ──

export function Throw(message: Expr): EvalNode {
  return { tisyn: "eval", id: "throw", data: Q({ message }) };
}

// ── Try ──

export function Try(
  body: Expr,
  catchParam?: string,
  catchBody?: Expr,
  finallyBody?: Expr,
  finallyPayload?: string,
): EvalNode {
  const fields: Record<string, unknown> = { body };
  if (catchParam !== undefined) fields["catchParam"] = catchParam;
  if (catchBody !== undefined) fields["catchBody"] = catchBody;
  if (finallyBody !== undefined) fields["finally"] = finallyBody;
  if (finallyPayload !== undefined) fields["finallyPayload"] = finallyPayload;
  return { tisyn: "eval", id: "try", data: Q(fields) };
}

// ── Spread rebuild ops (quoted data) ──

export function ConcatArrays(arrays: Expr[]): EvalNode {
  return { tisyn: "eval", id: "concat-arrays", data: Q({ arrays }) };
}

export function MergeObjects(objects: Expr[]): EvalNode {
  return { tisyn: "eval", id: "merge-objects", data: Q({ objects }) };
}

// ── External effects (unquoted data) ──

export function ExternalEval(id: string, data: Expr): EvalNode {
  return { tisyn: "eval", id, data };
}

// ── Compound external effects (quoted data) ──

export function AllEval(exprs: Expr[]): EvalNode {
  return { tisyn: "eval", id: "all", data: Q({ exprs }) };
}

export function RaceEval(exprs: Expr[]): EvalNode {
  return { tisyn: "eval", id: "race", data: Q({ exprs }) };
}

export function ScopeEval(
  handler: FnNode | null,
  bindings: Record<string, Expr>,
  body: Expr,
): EvalNode {
  return { tisyn: "eval", id: "scope", data: Q({ handler, bindings, body }) };
}
