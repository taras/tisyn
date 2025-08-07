export type Expr<T> = T | Eval<T, unknown> | Quote<T>;

interface Eval<T, TInput = unknown> {
  tisyn: "eval";
  id: string;
  data: TInput;
  T?: T;
}

export interface Quote<T> {
  tisyn: "quote";
  expr: Expr<T>;
}

export function Q<T>(expr: Expr<T>): Quote<T> {
  return {
    tisyn: "quote",
    expr,
  };
}

export function If<T>(
  condition: Expr<boolean>,
  then: Expr<T>,
  $else?: Expr<T>,
): Expr<T> {
  return {
    tisyn: "eval",
    id: "if",
    data: Q({ condition, then, else: $else }),
  };
}

export function While<T>(
  condition: Expr<boolean>,
  exprs: [...Expr<unknown>[], Expr<T>],
): Expr<T> {
  return {
    tisyn: "eval",
    id: "while",
    data: Q({ condition, exprs }),
  };
}

export function Log(expr: Expr<unknown>): Expr<void> {
  return {
    tisyn: "eval",
    id: "log",
    data: expr,
  };
}

// how would function declarations work?
//
// Fn(Arg("a"), [
//   Arg("a"),
// ]);
