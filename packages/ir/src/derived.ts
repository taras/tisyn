import type {
  TisynExpr,
  LetNode, SeqNode, IfNode, WhileNode, CallNode,
  GetNode,
  AddNode, SubNode, MulNode, DivNode, ModNode, NegNode,
  GtNode, GteNode, LtNode, LteNode, EqNode, NeqNode,
  AndNode, OrNode, NotNode,
  ConstructNode, ArrayNode, ConcatNode,
  ThrowNode,
  AllNode, RaceNode,
} from "./types.js";

// ── Structural IDs ──

export const STRUCTURAL_IDS = [
  "let", "seq", "if", "while", "call", "get",
  "add", "sub", "mul", "div", "mod", "neg",
  "gt", "gte", "lt", "lte", "eq", "neq",
  "and", "or", "not",
  "construct", "array", "concat", "throw",
] as const;

export type StructuralId = (typeof STRUCTURAL_IDS)[number];

// ── Compound External IDs ──

export const COMPOUND_EXTERNAL_IDS = ["all", "race"] as const;

export type CompoundExternalId = (typeof COMPOUND_EXTERNAL_IDS)[number];

// ── Derived Unions ──

export type StructuralNode =
  | LetNode | SeqNode | IfNode | WhileNode | CallNode
  | GetNode
  | AddNode | SubNode | MulNode | DivNode | ModNode | NegNode
  | GtNode | GteNode | LtNode | LteNode | EqNode | NeqNode
  | AndNode | OrNode | NotNode
  | ConstructNode | ArrayNode | ConcatNode
  | ThrowNode;

export type CompoundExternalNode = AllNode | RaceNode;

export interface StandardExternalEvalNode {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TisynExpr;
}
