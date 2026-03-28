import type { TisynExpr } from "@tisyn/ir";
import {
  Ref,
  Q,
  Fn,
  Let,
  Seq,
  If,
  While,
  Call,
  Get,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Neg,
  Gt,
  Gte,
  Lt,
  Lte,
  Eq,
  Neq,
  And,
  Or,
  Not,
  Construct,
  Arr,
  Concat,
  ConcatArrays,
  MergeObjects,
  Throw,
  Eval,
  All,
  Race,
} from "@tisyn/ir";
import { DSLParseError } from "./errors.js";
import type { Token } from "./token.js";

export interface ConstructorEntry {
  minArgs: number;
  /** Infinity for variadic constructors. */
  maxArgs: number;
  dispatch(args: TisynExpr[], tok: Token): TisynExpr;
}

function requireString(
  v: TisynExpr,
  label: string,
  tok: Token,
): asserts v is string {
  if (typeof v !== "string") {
    throw new DSLParseError(label, tok.line, tok.column, tok.offset);
  }
}

function requireStringArray(
  v: TisynExpr,
  label: string,
  tok: Token,
): asserts v is string[] {
  if (
    !Array.isArray(v) ||
    !(v as unknown[]).every((x) => typeof x === "string")
  ) {
    throw new DSLParseError(label, tok.line, tok.column, tok.offset);
  }
}

function requireArray(
  v: TisynExpr,
  label: string,
  tok: Token,
): asserts v is TisynExpr[] {
  if (!Array.isArray(v)) {
    throw new DSLParseError(label, tok.line, tok.column, tok.offset);
  }
}

const TAGGED_NODE_KINDS = new Set(["eval", "quote", "ref", "fn"]);

function isTaggedNode(v: object): boolean {
  const tisyn = (v as Record<string, unknown>)["tisyn"];
  return typeof tisyn === "string" && TAGGED_NODE_KINDS.has(tisyn);
}

function requirePlainObject(
  v: TisynExpr,
  label: string,
  tok: Token,
): asserts v is Record<string, TisynExpr> {
  if (
    v === null ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    isTaggedNode(v as object)
  ) {
    throw new DSLParseError(label, tok.line, tok.column, tok.offset);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExpr = any;

export const CONSTRUCTOR_TABLE: Record<string, ConstructorEntry> = {
  Ref: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args, tok) {
      requireString(args[0], "Ref requires a string", tok);
      return Ref(args[0]) as TisynExpr;
    },
  },
  Q: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args) {
      return Q(args[0] as AnyExpr) as TisynExpr;
    },
  },
  Fn: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args, tok) {
      requireStringArray(args[0], "Fn params must be a string array", tok);
      return Fn(args[0], args[1] as AnyExpr) as TisynExpr;
    },
  },
  Let: {
    minArgs: 3,
    maxArgs: 3,
    dispatch(args, tok) {
      requireString(args[0], "Let name must be a string", tok);
      return Let(args[0], args[1] as AnyExpr, args[2] as AnyExpr) as TisynExpr;
    },
  },
  Seq: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      // Seq has a variadic tuple type; cast via any to avoid phantom-type mismatch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (Seq as (...a: any[]) => TisynExpr)(...args);
    },
  },
  If: {
    minArgs: 2,
    maxArgs: 3,
    dispatch(args) {
      return If(
        args[0] as AnyExpr,
        args[1] as AnyExpr,
        args[2] as AnyExpr,
      ) as TisynExpr;
    },
  },
  While: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args, tok) {
      requireArray(args[1], "While body must be an array", tok);
      return While(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Call: {
    minArgs: 1,
    maxArgs: Infinity,
    dispatch(args) {
      return Call(args[0] as AnyExpr, ...(args.slice(1) as AnyExpr[])) as TisynExpr;
    },
  },
  Get: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args, tok) {
      requireString(args[1], "Get key must be a string", tok);
      return Get(args[0] as AnyExpr, args[1]) as TisynExpr;
    },
  },
  Add: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Add(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Sub: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Sub(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Mul: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Mul(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Div: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Div(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Mod: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Mod(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Neg: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args) {
      return Neg(args[0] as AnyExpr) as TisynExpr;
    },
  },
  Gt: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Gt(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Gte: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Gte(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Lt: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Lt(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Lte: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Lte(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Eq: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Eq(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Neq: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Neq(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  And: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return And(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Or: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args) {
      return Or(args[0] as AnyExpr, args[1] as AnyExpr) as TisynExpr;
    },
  },
  Not: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args) {
      return Not(args[0] as AnyExpr) as TisynExpr;
    },
  },
  Construct: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args, tok) {
      requirePlainObject(args[0], "Construct requires an object argument", tok);
      return Construct(args[0] as AnyExpr) as TisynExpr;
    },
  },
  Arr: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return Arr(...(args as AnyExpr[])) as TisynExpr;
    },
  },
  Concat: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return Concat(...(args as AnyExpr[])) as TisynExpr;
    },
  },
  ConcatArrays: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return ConcatArrays(...(args as AnyExpr[])) as TisynExpr;
    },
  },
  MergeObjects: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return MergeObjects(...(args as AnyExpr[])) as TisynExpr;
    },
  },
  Throw: {
    minArgs: 1,
    maxArgs: 1,
    dispatch(args) {
      return Throw(args[0] as AnyExpr) as TisynExpr;
    },
  },
  Eval: {
    minArgs: 2,
    maxArgs: 2,
    dispatch(args, tok) {
      requireString(args[0], "Eval id must be a string", tok);
      return Eval(args[0], args[1] as AnyExpr) as TisynExpr;
    },
  },
  All: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return All(...(args as AnyExpr[])) as TisynExpr;
    },
  },
  Race: {
    minArgs: 0,
    maxArgs: Infinity,
    dispatch(args) {
      return Race(...(args as AnyExpr[])) as TisynExpr;
    },
  },
};

export const CONSTRUCTOR_NAMES = Object.keys(CONSTRUCTOR_TABLE).sort().join(", ");
