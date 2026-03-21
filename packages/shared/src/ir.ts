export type {
  EvalNode,
  QuoteNode,
  RefNode,
  FnNode,
  TisynExpr as Expr,
  NodeClassification,
} from "@tisyn/ir";

export {
  isEvalNode,
  isQuoteNode,
  isRefNode,
  isFnNode,
  isLiteral,
  classifyNode,
} from "@tisyn/ir";
