// ── Tagged node types ──

export interface EvalNode {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TisynExpr;
}

export interface QuoteNode<T = TisynExpr> {
  readonly tisyn: "quote";
  readonly expr: T;
}

export interface RefNode {
  readonly tisyn: "ref";
  readonly name: string;
}

export interface FnNode {
  readonly tisyn: "fn";
  readonly params: readonly string[];
  readonly body: TisynExpr;
}

// ── Literals ──

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly TisynExpr[];
export type JsonObject = { readonly [key: string]: TisynExpr };
export type TisynLiteral = JsonPrimitive | JsonArray | JsonObject;

// ── Expression (untyped) ──

export type TisynTaggedNode = EvalNode | QuoteNode | RefNode | FnNode;
export type TisynExpr = TisynTaggedNode | TisynLiteral;

// ── Structural Operation Data Shapes ──

export interface LetShape {
  readonly name: string;
  readonly value: TisynExpr;
  readonly body: TisynExpr;
}

export interface SeqShape {
  readonly exprs: readonly TisynExpr[];
}

export interface IfShape {
  readonly condition: TisynExpr;
  readonly then: TisynExpr;
  readonly else?: TisynExpr;
}

export interface WhileShape {
  readonly condition: TisynExpr;
  readonly exprs: readonly TisynExpr[];
}

export interface CallShape {
  readonly fn: TisynExpr;
  readonly args: readonly TisynExpr[];
}

export interface GetShape {
  readonly obj: TisynExpr;
  readonly key: string;
}

export interface BinaryShape {
  readonly a: TisynExpr;
  readonly b: TisynExpr;
}

export interface UnaryShape {
  readonly a: TisynExpr;
}

export interface ConstructShape {
  readonly [key: string]: TisynExpr;
}

export interface ArrayShape {
  readonly items: readonly TisynExpr[];
}

export interface ConcatShape {
  readonly parts: readonly TisynExpr[];
}

export interface ThrowShape {
  readonly message: TisynExpr;
}

export interface AllShape {
  readonly exprs: readonly TisynExpr[];
}

export interface RaceShape {
  readonly exprs: readonly TisynExpr[];
}

// ── Narrowed Structural Eval Types ──

export interface LetNode {
  readonly tisyn: "eval";
  readonly id: "let";
  readonly data: QuoteNode<LetShape>;
}

export interface SeqNode {
  readonly tisyn: "eval";
  readonly id: "seq";
  readonly data: QuoteNode<SeqShape>;
}

export interface IfNode {
  readonly tisyn: "eval";
  readonly id: "if";
  readonly data: QuoteNode<IfShape>;
}

export interface WhileNode {
  readonly tisyn: "eval";
  readonly id: "while";
  readonly data: QuoteNode<WhileShape>;
}

export interface CallNode {
  readonly tisyn: "eval";
  readonly id: "call";
  readonly data: QuoteNode<CallShape>;
}

export interface GetNode {
  readonly tisyn: "eval";
  readonly id: "get";
  readonly data: QuoteNode<GetShape>;
}

export interface AddNode {
  readonly tisyn: "eval";
  readonly id: "add";
  readonly data: QuoteNode<BinaryShape>;
}

export interface SubNode {
  readonly tisyn: "eval";
  readonly id: "sub";
  readonly data: QuoteNode<BinaryShape>;
}

export interface MulNode {
  readonly tisyn: "eval";
  readonly id: "mul";
  readonly data: QuoteNode<BinaryShape>;
}

export interface DivNode {
  readonly tisyn: "eval";
  readonly id: "div";
  readonly data: QuoteNode<BinaryShape>;
}

export interface ModNode {
  readonly tisyn: "eval";
  readonly id: "mod";
  readonly data: QuoteNode<BinaryShape>;
}

export interface NegNode {
  readonly tisyn: "eval";
  readonly id: "neg";
  readonly data: QuoteNode<UnaryShape>;
}

export interface GtNode {
  readonly tisyn: "eval";
  readonly id: "gt";
  readonly data: QuoteNode<BinaryShape>;
}

export interface GteNode {
  readonly tisyn: "eval";
  readonly id: "gte";
  readonly data: QuoteNode<BinaryShape>;
}

export interface LtNode {
  readonly tisyn: "eval";
  readonly id: "lt";
  readonly data: QuoteNode<BinaryShape>;
}

export interface LteNode {
  readonly tisyn: "eval";
  readonly id: "lte";
  readonly data: QuoteNode<BinaryShape>;
}

export interface EqNode {
  readonly tisyn: "eval";
  readonly id: "eq";
  readonly data: QuoteNode<BinaryShape>;
}

export interface NeqNode {
  readonly tisyn: "eval";
  readonly id: "neq";
  readonly data: QuoteNode<BinaryShape>;
}

export interface AndNode {
  readonly tisyn: "eval";
  readonly id: "and";
  readonly data: QuoteNode<BinaryShape>;
}

export interface OrNode {
  readonly tisyn: "eval";
  readonly id: "or";
  readonly data: QuoteNode<BinaryShape>;
}

export interface NotNode {
  readonly tisyn: "eval";
  readonly id: "not";
  readonly data: QuoteNode<UnaryShape>;
}

export interface ConstructNode {
  readonly tisyn: "eval";
  readonly id: "construct";
  readonly data: QuoteNode<ConstructShape>;
}

export interface ArrayNode {
  readonly tisyn: "eval";
  readonly id: "array";
  readonly data: QuoteNode<ArrayShape>;
}

export interface ConcatNode {
  readonly tisyn: "eval";
  readonly id: "concat";
  readonly data: QuoteNode<ConcatShape>;
}

export interface ThrowNode {
  readonly tisyn: "eval";
  readonly id: "throw";
  readonly data: QuoteNode<ThrowShape>;
}

export interface AllNode {
  readonly tisyn: "eval";
  readonly id: "all";
  readonly data: QuoteNode<AllShape>;
}

export interface RaceNode {
  readonly tisyn: "eval";
  readonly id: "race";
  readonly data: QuoteNode<RaceShape>;
}

export interface ConcatArraysShape {
  readonly arrays: readonly TisynExpr[];
}

export interface MergeObjectsShape {
  readonly objects: readonly TisynExpr[];
}

export interface ConcatArraysNode {
  readonly tisyn: "eval";
  readonly id: "concat-arrays";
  readonly data: QuoteNode<ConcatArraysShape>;
}

export interface MergeObjectsNode {
  readonly tisyn: "eval";
  readonly id: "merge-objects";
  readonly data: QuoteNode<MergeObjectsShape>;
}
