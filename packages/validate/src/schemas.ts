/**
 * TypeBox schemas for Tisyn IR nodes.
 *
 * These are schema documentation artifacts for JSON Schema export.
 * They do NOT drive runtime validation — the hand-written walker in
 * validate.ts is the validation engine and source of truth for
 * accept/reject decisions.
 */

import { Type, type TSchema } from "@sinclair/typebox";

export const EvalNodeSchema = Type.Object(
  {
    tisyn: Type.Literal("eval"),
    id: Type.String({ minLength: 1 }),
    data: Type.Any(),
  },
  { additionalProperties: true, $id: "EvalNode" },
);

export const QuoteNodeSchema = Type.Object(
  {
    tisyn: Type.Literal("quote"),
    expr: Type.Any(),
  },
  { additionalProperties: true, $id: "QuoteNode" },
);

export const RefNodeSchema = Type.Object(
  {
    tisyn: Type.Literal("ref"),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true, $id: "RefNode" },
);

export const FnNodeSchema = Type.Object(
  {
    tisyn: Type.Literal("fn"),
    params: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    body: Type.Any(),
  },
  { additionalProperties: true, $id: "FnNode" },
);

export const TisynExprSchema: TSchema = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object(
        {
          tisyn: Type.Literal("eval"),
          id: Type.String({ minLength: 1 }),
          data: This,
        },
        { additionalProperties: true },
      ),
      Type.Object(
        {
          tisyn: Type.Literal("quote"),
          expr: This,
        },
        { additionalProperties: true },
      ),
      Type.Object(
        {
          tisyn: Type.Literal("ref"),
          name: Type.String({ minLength: 1 }),
        },
        { additionalProperties: true },
      ),
      Type.Object(
        {
          tisyn: Type.Literal("fn"),
          params: Type.Array(Type.String({ minLength: 1 })),
          body: This,
        },
        { additionalProperties: true },
      ),
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Null(),
      Type.Array(This),
      Type.Record(Type.String(), This),
    ]),
  { $id: "TisynExpr" },
);
