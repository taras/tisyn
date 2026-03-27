import type { TisynExpr } from "./types.js";
import { isEvalNode, isQuoteNode, isRefNode, isFnNode } from "./guards.js";
import { classify } from "./classify.js";

export interface TisynAlgebra<A> {
  // Primitives
  literal(value: TisynExpr): A;
  ref(name: string): A;
  fn(params: readonly string[], body: A): A;
  quote(expr: TisynExpr): A;

  // Structural operations
  let(name: string, value: A, body: A): A;
  seq(exprs: A[]): A;
  if(condition: A, then_: A, else_: A | null): A;
  while(condition: A, body: A[]): A;
  call(fn: A, args: A[]): A;
  get(obj: A, key: string): A;

  // Binary arithmetic
  add(a: A, b: A): A;
  sub(a: A, b: A): A;
  mul(a: A, b: A): A;
  div(a: A, b: A): A;
  mod(a: A, b: A): A;

  // Comparison
  gt(a: A, b: A): A;
  gte(a: A, b: A): A;
  lt(a: A, b: A): A;
  lte(a: A, b: A): A;
  eq(a: A, b: A): A;
  neq(a: A, b: A): A;

  // Logical
  and(a: A, b: A): A;
  or(a: A, b: A): A;
  not(a: A): A;

  // Unary
  neg(a: A): A;

  // Data construction
  construct(fields: Record<string, A>): A;
  array(items: A[]): A;
  concat(parts: A[]): A;
  concatArrays(arrays: A[]): A;
  mergeObjects(objects: A[]): A;

  // Error
  throw(message: A): A;

  // External eval (opaque to the fold — data not recursed)
  eval(id: string, data: TisynExpr): A;
}

export function fold<A>(expr: TisynExpr, algebra: TisynAlgebra<A>): A {
  return foldNode(expr, algebra);
}

function foldNode<A>(expr: TisynExpr, alg: TisynAlgebra<A>): A {
  // Primitives
  if (expr === null || typeof expr !== "object") {
    return alg.literal(expr);
  }

  if (Array.isArray(expr)) {
    return alg.literal(expr);
  }

  if (isRefNode(expr)) {
    return alg.ref(expr.name);
  }

  if (isQuoteNode(expr)) {
    return alg.quote(expr.expr as TisynExpr);
  }

  if (isFnNode(expr)) {
    const body = foldNode(expr.body as TisynExpr, alg);
    return alg.fn(expr.params, body);
  }

  if (isEvalNode(expr)) {
    const cls = classify(expr.id);

    if (cls === "external") {
      // External eval — data is opaque, not recursed
      return alg.eval(expr.id, expr.data as TisynExpr);
    }

    // Structural eval — unquote data and recurse into children
    const data = expr.data as Record<string, unknown>;
    const shape =
      data && typeof data === "object" && "tisyn" in data && data["tisyn"] === "quote"
        ? (data as { expr: Record<string, unknown> }).expr
        : data;

    return foldStructural(expr.id, shape as Record<string, unknown>, alg);
  }

  // Plain object literal
  return alg.literal(expr);
}

function foldStructural<A>(id: string, shape: Record<string, unknown>, alg: TisynAlgebra<A>): A {
  switch (id) {
    case "let": {
      const s = shape as { name: string; value: TisynExpr; body: TisynExpr };
      return alg.let(s.name, foldNode(s.value, alg), foldNode(s.body, alg));
    }
    case "seq": {
      const s = shape as { exprs: TisynExpr[] };
      return alg.seq(s.exprs.map((e) => foldNode(e, alg)));
    }
    case "if": {
      const s = shape as { condition: TisynExpr; then: TisynExpr; else?: TisynExpr };
      return alg.if(
        foldNode(s.condition, alg),
        foldNode(s.then, alg),
        s.else !== undefined ? foldNode(s.else, alg) : null,
      );
    }
    case "while": {
      const s = shape as { condition: TisynExpr; exprs: TisynExpr[] };
      return alg.while(
        foldNode(s.condition, alg),
        s.exprs.map((e) => foldNode(e, alg)),
      );
    }
    case "call": {
      const s = shape as { fn: TisynExpr; args: TisynExpr[] };
      return alg.call(
        foldNode(s.fn, alg),
        s.args.map((e) => foldNode(e, alg)),
      );
    }
    case "get": {
      const s = shape as { obj: TisynExpr; key: string };
      return alg.get(foldNode(s.obj, alg), s.key);
    }
    case "add":
      return foldBinary(shape, alg.add.bind(alg), alg);
    case "sub":
      return foldBinary(shape, alg.sub.bind(alg), alg);
    case "mul":
      return foldBinary(shape, alg.mul.bind(alg), alg);
    case "div":
      return foldBinary(shape, alg.div.bind(alg), alg);
    case "mod":
      return foldBinary(shape, alg.mod.bind(alg), alg);
    case "gt":
      return foldBinary(shape, alg.gt.bind(alg), alg);
    case "gte":
      return foldBinary(shape, alg.gte.bind(alg), alg);
    case "lt":
      return foldBinary(shape, alg.lt.bind(alg), alg);
    case "lte":
      return foldBinary(shape, alg.lte.bind(alg), alg);
    case "eq":
      return foldBinary(shape, alg.eq.bind(alg), alg);
    case "neq":
      return foldBinary(shape, alg.neq.bind(alg), alg);
    case "and":
      return foldBinary(shape, alg.and.bind(alg), alg);
    case "or":
      return foldBinary(shape, alg.or.bind(alg), alg);
    case "not": {
      const s = shape as { a: TisynExpr };
      return alg.not(foldNode(s.a, alg));
    }
    case "neg": {
      const s = shape as { a: TisynExpr };
      return alg.neg(foldNode(s.a, alg));
    }
    case "construct": {
      const result: Record<string, A> = {};
      for (const key of Object.keys(shape)) {
        result[key] = foldNode(shape[key] as TisynExpr, alg);
      }
      return alg.construct(result);
    }
    case "array": {
      const s = shape as { items: TisynExpr[] };
      return alg.array(s.items.map((e) => foldNode(e, alg)));
    }
    case "concat": {
      const s = shape as { parts: TisynExpr[] };
      return alg.concat(s.parts.map((e) => foldNode(e, alg)));
    }
    case "throw": {
      const s = shape as { message: TisynExpr };
      return alg.throw(foldNode(s.message, alg));
    }
    case "concat-arrays": {
      const s = shape as { arrays: TisynExpr[] };
      return alg.concatArrays(s.arrays.map((e) => foldNode(e, alg)));
    }
    case "merge-objects": {
      const s = shape as { objects: TisynExpr[] };
      return alg.mergeObjects(s.objects.map((e) => foldNode(e, alg)));
    }
    default:
      // Unknown structural ID — should not happen, treat as literal
      return alg.literal(shape as TisynExpr);
  }
}

function foldBinary<A>(
  shape: Record<string, unknown>,
  handler: (a: A, b: A) => A,
  alg: TisynAlgebra<A>,
): A {
  const s = shape as { a: TisynExpr; b: TisynExpr };
  return handler(foldNode(s.a, alg), foldNode(s.b, alg));
}

export function defaultAlgebra<A>(zero: () => A): TisynAlgebra<A> {
  const z = () => zero();
  const z2 = () => zero();
  return {
    literal: z,
    ref: z,
    fn: z2,
    quote: z,
    let: z2,
    seq: z,
    if: z2,
    while: z2,
    call: z2,
    get: z2,
    add: z2,
    sub: z2,
    mul: z2,
    div: z2,
    mod: z2,
    gt: z2,
    gte: z2,
    lt: z2,
    lte: z2,
    eq: z2,
    neq: z2,
    and: z2,
    or: z2,
    not: z,
    neg: z,
    construct: z,
    array: z,
    concat: z,
    concatArrays: z,
    mergeObjects: z,
    throw: z,
    eval: z2,
  };
}

export function foldWith<A>(
  expr: TisynExpr,
  base: TisynAlgebra<A>,
  overrides: Partial<TisynAlgebra<A>>,
): A {
  const merged = { ...base, ...overrides };
  return fold(expr, merged);
}
