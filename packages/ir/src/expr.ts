import type { TisynExpr } from "./types.js";

export interface Eval<T, TData = unknown> {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TData;
  readonly T?: T;
}

export interface Quote<T> {
  readonly tisyn: "quote";
  readonly expr: Expr<T>;
}

export interface Ref<T> {
  readonly tisyn: "ref";
  readonly name: string;
  readonly T?: T;
}

export interface TisynFn<A extends unknown[], R> {
  readonly tisyn: "fn";
  readonly params: readonly string[];
  readonly body: Expr<R>;
  readonly T?: (...args: A) => R;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Expr<T> = T | Eval<T> | Quote<T> | Ref<T> | TisynFn<any[], T>;

export type ExprResult<E> = E extends Expr<infer T> ? T : never;

export type AsExpr<T> = TisynExpr & Expr<T>;

/** Accepts both untyped TisynExpr and phantom-typed Expr nodes as IR input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IrInput = TisynExpr | Expr<any>;
