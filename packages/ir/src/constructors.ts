import type { TisynExpr } from "./types.js";
import type { Expr, Eval as EvalT, Quote as QuoteT, Ref as RefT, TisynFn } from "./expr.js";

function binary<T>(id: string, a: Expr<unknown>, b: Expr<unknown>): EvalT<T> {
  return {
    tisyn: "eval",
    id,
    data: { tisyn: "quote", expr: { a, b } },
  } as EvalT<T>;
}

function unary<T>(id: string, a: Expr<unknown>): EvalT<T> {
  return {
    tisyn: "eval",
    id,
    data: { tisyn: "quote", expr: { a } },
  } as EvalT<T>;
}

export function Ref<T>(name: string): RefT<T> {
  return { tisyn: "ref", name } as RefT<T>;
}

export function Q<T>(expr: Expr<T>): QuoteT<T> {
  return { tisyn: "quote", expr } as QuoteT<T>;
}

export function Fn<A extends unknown[], R>(params: string[], body: Expr<R>): TisynFn<A, R> {
  return { tisyn: "fn", params, body } as TisynFn<A, R>;
}

// ── Structural Operation Constructors ──

export function Let<T>(name: string, value: Expr<unknown>, body: Expr<T>): EvalT<T> {
  return {
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  } as EvalT<T>;
}

export function Seq<T>(...exprs: [...Expr<unknown>[], Expr<T>]): EvalT<T> {
  return {
    tisyn: "eval",
    id: "seq",
    data: { tisyn: "quote", expr: { exprs } },
  } as EvalT<T>;
}

export function If<T>(condition: Expr<boolean>, then_: Expr<T>, else_?: Expr<T>): EvalT<T> {
  const fields: Record<string, unknown> = { condition, then: then_ };
  if (else_ !== undefined) {
    fields["else"] = else_;
  }
  return {
    tisyn: "eval",
    id: "if",
    data: { tisyn: "quote", expr: fields },
  } as EvalT<T>;
}

export function While<T>(condition: Expr<boolean>, exprs: [...Expr<unknown>[], Expr<T>]): EvalT<T> {
  return {
    tisyn: "eval",
    id: "while",
    data: { tisyn: "quote", expr: { condition, exprs } },
  } as EvalT<T>;
}

export function Call<A extends unknown[], R>(
  fn: Expr<(...args: A) => R> | TisynFn<A, R>,
  ...args: { [K in keyof A]: Expr<A[K]> }
): EvalT<R> {
  return {
    tisyn: "eval",
    id: "call",
    data: { tisyn: "quote", expr: { fn, args } },
  } as EvalT<R>;
}

export function Get<T>(obj: Expr<unknown>, key: string): EvalT<T> {
  return {
    tisyn: "eval",
    id: "get",
    data: { tisyn: "quote", expr: { obj, key } },
  } as EvalT<T>;
}

// ── Arithmetic ──

export function Add(a: Expr<number>, b: Expr<number>): EvalT<number> {
  return binary<number>("add", a, b);
}

export function Sub(a: Expr<number>, b: Expr<number>): EvalT<number> {
  return binary<number>("sub", a, b);
}

export function Mul(a: Expr<number>, b: Expr<number>): EvalT<number> {
  return binary<number>("mul", a, b);
}

export function Div(a: Expr<number>, b: Expr<number>): EvalT<number> {
  return binary<number>("div", a, b);
}

export function Mod(a: Expr<number>, b: Expr<number>): EvalT<number> {
  return binary<number>("mod", a, b);
}

export function Neg(a: Expr<number>): EvalT<number> {
  return unary<number>("neg", a);
}

// ── Comparison ──

export function Gt(a: Expr<number>, b: Expr<number>): EvalT<boolean> {
  return binary<boolean>("gt", a, b);
}

export function Gte(a: Expr<number>, b: Expr<number>): EvalT<boolean> {
  return binary<boolean>("gte", a, b);
}

export function Lt(a: Expr<number>, b: Expr<number>): EvalT<boolean> {
  return binary<boolean>("lt", a, b);
}

export function Lte(a: Expr<number>, b: Expr<number>): EvalT<boolean> {
  return binary<boolean>("lte", a, b);
}

export function Eq(a: Expr<unknown>, b: Expr<unknown>): EvalT<boolean> {
  return binary<boolean>("eq", a, b);
}

export function Neq(a: Expr<unknown>, b: Expr<unknown>): EvalT<boolean> {
  return binary<boolean>("neq", a, b);
}

// ── Logical ──

export function And<T>(a: Expr<T>, b: Expr<T>): EvalT<T> {
  return binary<T>("and", a, b);
}

export function Or<T>(a: Expr<T>, b: Expr<T>): EvalT<T> {
  return binary<T>("or", a, b);
}

export function Not(a: Expr<unknown>): EvalT<boolean> {
  return unary<boolean>("not", a);
}

// ── Data construction ──

export function Construct<T extends Record<string, unknown>>(fields: {
  [K in keyof T]: Expr<T[K]>;
}): EvalT<T> {
  return {
    tisyn: "eval",
    id: "construct",
    data: { tisyn: "quote", expr: fields },
  } as EvalT<T>;
}

export function Arr<T>(...items: Expr<T>[]): EvalT<T[]> {
  return {
    tisyn: "eval",
    id: "array",
    data: { tisyn: "quote", expr: { items } },
  } as EvalT<T[]>;
}

export function Concat(...parts: Expr<unknown>[]): EvalT<string> {
  return {
    tisyn: "eval",
    id: "concat",
    data: { tisyn: "quote", expr: { parts } },
  } as EvalT<string>;
}

// ── Error ──

export function Throw(message: Expr<string>): EvalT<never> {
  return {
    tisyn: "eval",
    id: "throw",
    data: { tisyn: "quote", expr: { message } },
  } as EvalT<never>;
}

export function Eval<T>(id: string, data: Expr<unknown>): EvalT<T> {
  return {
    tisyn: "eval",
    id,
    data,
  } as EvalT<T>;
}

export function All<T extends unknown[]>(...exprs: { [K in keyof T]: Expr<T[K]> }): EvalT<T> {
  return {
    tisyn: "eval",
    id: "all",
    data: { tisyn: "quote", expr: { exprs } },
  } as EvalT<T>;
}

export function Race<T>(...exprs: Expr<T>[]): EvalT<T> {
  return {
    tisyn: "eval",
    id: "race",
    data: { tisyn: "quote", expr: { exprs } },
  } as EvalT<T>;
}
