# Tisyn Authoring Layer Specification

**Version:** 0.3.0
**Implements:** Tisyn System Specification 1.0.0
**Status:** Draft

---

## 1. Overview

This document specifies the authoring layer: TypeScript types,
constructor functions, traversal utilities, and validation schemas
that make Tisyn IR practical to construct, inspect, and transform.

The authoring layer is NOT the compiler. It does not transform
generator functions. It provides the programmatic surface for
working with IR as data.

Compiler-recognized authored forms such as
`for (const x of yield* each(expr)) { ... }` and
`yield* useConfig(Token)` belong to the workflow compiler
surface, not to the constructor-style authoring layer defined
in this document. `each(...)` and `useConfig()` are therefore
not general IR-construction helpers here.

### 1.1 Design Principles

**Grammar and result types, not scope.** The authoring layer
types the IR grammar and tracks intended result types via
`Expr<T>`. It enforces structural correctness (a `let` node has
`name`, `value`, `body`) and result-type consistency (an `if`
node's branches must agree on `T`, a condition must be
`Expr<boolean>`, arithmetic operands must be `Expr<number>`).
`Expr<T>` tracks intended result type for composition — it does
not prove the runtime environment will satisfy that intent.
`Ref<number>("x")` type-checks as `Expr<number>` even though
the system does not verify that `"x"` is bound to a number.

The authoring layer does NOT track variable scope — it does not
attempt to prove that a `Ref` name is bound, or that free
variables are satisfied at call sites. Compiler-generated IR
guarantees scope correctness for code within the supported
source subset. For IR from other sources, validation and the
kernel enforce it.

**`Expr<T>` is narrowly scoped.** The `T` parameter represents
constructor signatures, branch agreement, and operand/result
threading. It MUST NOT be extended to carry effect sets,
environment requirements, replay metadata, or open-function
obligations. Those concerns belong to the compiler, runtime,
and kernel respectively.

**Two type layers.** The types serve two audiences:

- **Authoring types** (`Expr<T>`, `Eval<T>`, `Ref<T>`, etc.)
  carry result types via phantom parameters. Used by constructor
  signatures. The `T` parameter flows through composition,
  catching type mismatches at construction time.

- **Grammar types** (`TisynExpr`, `LetNode`, `IfNode`, etc.)
  describe exact node structure with narrowed data shapes. Used
  by fold, transform, validate, and the kernel. No result type
  parameter.

A value produced by a constructor satisfies both layers. The
grammar types are the structural ground truth. The authoring
types layer result-type tracking on top.

**Constructors are the normative API.** Constructor functions are
the supported way to build IR. They produce structurally correct
nodes — correct discriminant, correct Quote wrapping, correct
data shapes — without structural casts. Phantom casts (`as
Expr<T>`) are permitted where required to establish result-type
parameters that have no runtime representation. Direct object
literal construction is a valid escape hatch for interop and
testing, but is not guarded and not recommended for application
code.

**Construction, not validation.** Constructor functions produce
structurally correct IR. Validation schemas check IR received
from external sources. These are separate concerns with separate
implementations.

**JSON-first.** Every value produced by a constructor is
JSON-round-trip safe. No classes, no prototypes, no Symbols at
runtime. Phantom `T?` fields are optional and stripped by
`JSON.stringify`.

### 1.2 Scope Boundary

The authoring layer's grammar types describe IR when used as IR —
that is, when appearing as nodes in an expression tree being
constructed, traversed, or compiled.

Whether a JSON object is an expression or an opaque value at
runtime is context-sensitive and belongs to the kernel semantics
(System Specification §2.3). Agent-returned data, journal
values, and environment bindings are NOT reinterpreted as IR
nodes solely because they happen to contain a `tisyn` field.
The authoring layer does not model this runtime distinction.

---

## 2. Package Organization

```
@tisyn/ir          ← types + constructors + traversal + print
@tisyn/kernel      ← evaluator (eval, env, resolve, unquote)
@tisyn/runtime     ← execution layer (journal, replay, tasks)
@tisyn/compiler    ← generator → IR
@tisyn/validate    ← boundary validation schemas
@tisyn/protocol    ← wire protocol types (JSON-RPC, agent)
@tisyn/cli         ← CLI entry point
```

### 2.1 `@tisyn/ir`

The foundational package. Zero runtime dependencies. Contains:

- TypeScript types for all IR nodes (§3)
- Constructor functions for all node kinds (§4)
- The `classify` function and structural/external ID sets (§5)
- Traversal: walk, fold, transform (§6)
- Pretty-printer and decompiler (§7)

Every other package depends on `@tisyn/ir`. It MUST NOT depend
on any other `@tisyn/*` package.

**Internal structure:**

```
@tisyn/ir/
  src/
    types.ts          ← exact grammar types (§3.1–3.3)
    expr.ts           ← result-typed authoring types (§3.5)
    derived.ts        ← convenience unions, helpers (§3.4)
    constructors.ts   ← factory functions
    classify.ts       ← structural/external classification
    walk.ts           ← side-effect traversal
    fold.ts           ← generic fold (catamorphism)
    transform.ts      ← tree transformer (map + replace)
    print.ts          ← constructor-call debug representation
    decompile.ts      ← TypeScript source representation
    index.ts          ← public API barrel
```

### 2.2 `@tisyn/kernel`

The evaluator. Pure IR interpretation. Depends on `@tisyn/ir`
for types and classification. Contains NO execution-layer
concerns — no journal, no tasks, no replay.

```
@tisyn/kernel/
  src/
    eval.ts           ← eval function, dispatch
    env.ts            ← environment (linked frame list)
    resolve.ts        ← resolve function (external data prep)
    unquote.ts        ← unquote function (structural data prep)
    errors.ts         ← kernel error types
    index.ts
```

### 2.3 `@tisyn/runtime`

The execution layer. Orchestrates kernel evaluation with
durable state. Depends on `@tisyn/ir` and `@tisyn/kernel`.

```
@tisyn/runtime/
  src/
    journal.ts        ← journal types, durable stream
    replay.ts         ← replay index, matching algorithm
    task.ts           ← task tree, lifecycle, states
    scheduler.ts      ← task scheduling, concurrency
    cancellation.ts   ← structured cancellation propagation
    index.ts
```

### 2.4 `@tisyn/compiler`

Generator-to-IR compiler. Depends on `@tisyn/ir` for constructors.

```
@tisyn/compiler/
  src/
    parse.ts          ← TypeScript AST parsing
    discover.ts       ← annotation pass (yield* detection, scope)
    transform.ts      ← AST → IR transformation
    emit.ts           ← IR → JSON serialization
    diagnostics.ts    ← error codes E001–E030
    index.ts
```

### 2.5 `@tisyn/validate`

Boundary validation schemas. Depends on `@tisyn/ir` for types.
Uses TypeBox internally.

```
@tisyn/validate/
  src/
    schemas.ts        ← TypeBox schemas mirroring exact grammar types
    validate.ts       ← validateGrammar, validateScope, validateIr
    json-schema.ts    ← exported JSON Schema for cross-language use
    index.ts
```

### 2.6 `@tisyn/protocol`

Host ↔ agent wire protocol types. JSON-RPC messages only. Does
NOT contain journal events — those belong to `@tisyn/runtime`.

```
@tisyn/protocol/
  src/
    messages.ts       ← Execute, Result, Progress, Cancel, Shutdown
    agent.ts          ← Agent definition, AgentClient types
    index.ts
```

### 2.7 `@tisyn/cli`

Command-line interface. Depends on everything.

```
@tisyn/cli/
  src/
    compile.ts        ← tisyn compile <input.ts>
    validate.ts       ← tisyn validate <input.json>
    print.ts          ← tisyn print <input.json>
    decompile.ts      ← tisyn decompile <input.json>
    run.ts            ← tisyn run <input.json>
    index.ts
```

### 2.8 Dependency Graph

```
@tisyn/cli
  ├── @tisyn/compiler  → @tisyn/ir
  ├── @tisyn/runtime   → @tisyn/kernel → @tisyn/ir
  ├── @tisyn/validate  → @tisyn/ir
  └── @tisyn/protocol  → @tisyn/ir
```

`@tisyn/ir` is the root. No cycles. `@tisyn/kernel` depends
only on `@tisyn/ir`. `@tisyn/runtime` depends on both
`@tisyn/kernel` and `@tisyn/ir`. `@tisyn/compiler` depends
only on `@tisyn/ir`. No package depends on `@tisyn/cli`.

---

## 3. Type Definitions

### 3.1 Exact Grammar Types (`@tisyn/ir/types.ts`)

These types describe the IR grammar precisely. They are the
source of truth for node structure. They carry NO result type
parameter — they are used by fold, transform, validate, and
the kernel.

The IR has **4 tagged node types** discriminated by the `tisyn`
field, plus **JSON literals** (values without a matching `tisyn`
field). The tagged nodes and literals together form `TisynExpr`.

```typescript
// ── Tagged node types ──

interface EvalNode {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TisynExpr;
}

interface QuoteNode<T = TisynExpr> {
  readonly tisyn: "quote";
  readonly expr: T;
}

interface RefNode {
  readonly tisyn: "ref";
  readonly name: string;
}

interface FnNode {
  readonly tisyn: "fn";
  readonly params: readonly string[];
  readonly body: TisynExpr;
}

// ── Literals ──

type JsonPrimitive = string | number | boolean | null;
type JsonArray = readonly TisynExpr[];
type JsonObject = { readonly [key: string]: TisynExpr };
type TisynLiteral = JsonPrimitive | JsonArray | JsonObject;

// ── Expression (untyped) ──

type TisynTaggedNode = EvalNode | QuoteNode | RefNode | FnNode;
type TisynExpr = TisynTaggedNode | TisynLiteral;
```

`QuoteNode<T>` is generic for data shape typing. When
unparameterized, `T` defaults to `TisynExpr`. Structural node
types parameterize it: `QuoteNode<LetShape>`, etc.

### 3.2 Structural Operation Data Shapes

Each structural operation has a defined data shape. These types
describe the contents of the `QuoteNode.expr` field.

```typescript
// ── Binding and control flow ──

interface LetShape {
  readonly name: string;
  readonly value: TisynExpr;
  readonly body: TisynExpr;
}

interface SeqShape {
  readonly exprs: readonly TisynExpr[];
}

interface IfShape {
  readonly condition: TisynExpr;
  readonly then: TisynExpr;
  readonly else?: TisynExpr;
}

interface WhileShape {
  readonly condition: TisynExpr;
  readonly exprs: readonly TisynExpr[];
}

interface CallShape {
  readonly fn: TisynExpr;
  readonly args: readonly TisynExpr[];
}

// ── Property access ──

interface GetShape {
  readonly obj: TisynExpr;
  readonly key: string;
}

// ── Binary operations ──

interface BinaryShape {
  readonly a: TisynExpr;
  readonly b: TisynExpr;
}

// ── Unary operations ──

interface UnaryShape {
  readonly a: TisynExpr;
}

// ── Data construction ──

interface ConstructShape {
  readonly [key: string]: TisynExpr;
}

interface ArrayShape {
  readonly items: readonly TisynExpr[];
}

interface ConcatShape {
  readonly parts: readonly TisynExpr[];
}

// ── Error ──

interface ThrowShape {
  readonly message: TisynExpr;
}

// ── Concurrency ──

interface AllShape {
  readonly exprs: readonly TisynExpr[];
}

interface RaceShape {
  readonly exprs: readonly TisynExpr[];
}
```

### 3.3 Narrowed Structural Eval Types

These types allow `switch (node.id)` to narrow the data shape.
Each structural operation gets a dedicated type with a literal
`id` and a parameterized `QuoteNode<Shape>` for data.

```typescript
// ── Binding and control flow ──

interface LetNode {
  readonly tisyn: "eval";
  readonly id: "let";
  readonly data: QuoteNode<LetShape>;
}

interface SeqNode {
  readonly tisyn: "eval";
  readonly id: "seq";
  readonly data: QuoteNode<SeqShape>;
}

interface IfNode {
  readonly tisyn: "eval";
  readonly id: "if";
  readonly data: QuoteNode<IfShape>;
}

interface WhileNode {
  readonly tisyn: "eval";
  readonly id: "while";
  readonly data: QuoteNode<WhileShape>;
}

interface CallNode {
  readonly tisyn: "eval";
  readonly id: "call";
  readonly data: QuoteNode<CallShape>;
}

// ── Property access ──

interface GetNode {
  readonly tisyn: "eval";
  readonly id: "get";
  readonly data: QuoteNode<GetShape>;
}

// ── Arithmetic ──

interface AddNode {
  readonly tisyn: "eval";
  readonly id: "add";
  readonly data: QuoteNode<BinaryShape>;
}

interface SubNode {
  readonly tisyn: "eval";
  readonly id: "sub";
  readonly data: QuoteNode<BinaryShape>;
}

interface MulNode {
  readonly tisyn: "eval";
  readonly id: "mul";
  readonly data: QuoteNode<BinaryShape>;
}

interface DivNode {
  readonly tisyn: "eval";
  readonly id: "div";
  readonly data: QuoteNode<BinaryShape>;
}

interface ModNode {
  readonly tisyn: "eval";
  readonly id: "mod";
  readonly data: QuoteNode<BinaryShape>;
}

interface NegNode {
  readonly tisyn: "eval";
  readonly id: "neg";
  readonly data: QuoteNode<UnaryShape>;
}

// ── Comparison ──

interface GtNode {
  readonly tisyn: "eval";
  readonly id: "gt";
  readonly data: QuoteNode<BinaryShape>;
}

interface GteNode {
  readonly tisyn: "eval";
  readonly id: "gte";
  readonly data: QuoteNode<BinaryShape>;
}

interface LtNode {
  readonly tisyn: "eval";
  readonly id: "lt";
  readonly data: QuoteNode<BinaryShape>;
}

interface LteNode {
  readonly tisyn: "eval";
  readonly id: "lte";
  readonly data: QuoteNode<BinaryShape>;
}

interface EqNode {
  readonly tisyn: "eval";
  readonly id: "eq";
  readonly data: QuoteNode<BinaryShape>;
}

interface NeqNode {
  readonly tisyn: "eval";
  readonly id: "neq";
  readonly data: QuoteNode<BinaryShape>;
}

// ── Logical ──

interface AndNode {
  readonly tisyn: "eval";
  readonly id: "and";
  readonly data: QuoteNode<BinaryShape>;
}

interface OrNode {
  readonly tisyn: "eval";
  readonly id: "or";
  readonly data: QuoteNode<BinaryShape>;
}

interface NotNode {
  readonly tisyn: "eval";
  readonly id: "not";
  readonly data: QuoteNode<UnaryShape>;
}

// ── Data construction ──

interface ConstructNode {
  readonly tisyn: "eval";
  readonly id: "construct";
  readonly data: QuoteNode<ConstructShape>;
}

interface ArrayNode {
  readonly tisyn: "eval";
  readonly id: "array";
  readonly data: QuoteNode<ArrayShape>;
}

interface ConcatNode {
  readonly tisyn: "eval";
  readonly id: "concat";
  readonly data: QuoteNode<ConcatShape>;
}

// ── Error ──

interface ThrowNode {
  readonly tisyn: "eval";
  readonly id: "throw";
  readonly data: QuoteNode<ThrowShape>;
}

// ── Compound external ──

interface AllNode {
  readonly tisyn: "eval";
  readonly id: "all";
  readonly data: QuoteNode<AllShape>;
}

interface RaceNode {
  readonly tisyn: "eval";
  readonly id: "race";
  readonly data: QuoteNode<RaceShape>;
}
```

### 3.4 Derived Unions and Helpers (`@tisyn/ir/derived.ts`)

Convenience unions built from the exact grammar types. For
pattern matching and API signatures, not source-of-truth.

```typescript
type StructuralNode =
  | LetNode
  | SeqNode
  | IfNode
  | WhileNode
  | CallNode
  | GetNode
  | AddNode
  | SubNode
  | MulNode
  | DivNode
  | ModNode
  | NegNode
  | GtNode
  | GteNode
  | LtNode
  | LteNode
  | EqNode
  | NeqNode
  | AndNode
  | OrNode
  | NotNode
  | ConstructNode
  | ArrayNode
  | ConcatNode
  | ThrowNode;

type CompoundExternalNode = AllNode | RaceNode;

interface StandardExternalEvalNode {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TisynExpr;
}

const STRUCTURAL_IDS = [
  "let",
  "seq",
  "if",
  "while",
  "call",
  "get",
  "add",
  "sub",
  "mul",
  "div",
  "mod",
  "neg",
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "and",
  "or",
  "not",
  "construct",
  "array",
  "concat",
  "throw",
] as const;

type StructuralId = (typeof STRUCTURAL_IDS)[number];

const COMPOUND_EXTERNAL_IDS = ["all", "race"] as const;
type CompoundExternalId = (typeof COMPOUND_EXTERNAL_IDS)[number];
```

### 3.5 Result-Typed Authoring Types (`@tisyn/ir/expr.ts`)

These types carry a result type parameter `T` for compile-time
composition safety. They layer on top of the grammar types —
same runtime shape, additional type-level information.

```typescript
type Expr<T> = T | Eval<T> | Quote<T> | Ref<T> | TisynFn<any[], T>;
```

`Expr<T>` is the primary authoring type. `T` is the intended
result type — the type of value the expression is expected to
evaluate to. A literal value of type `T` is itself an `Expr<T>`:
`42` is `Expr<number>`, `"hello"` is `Expr<string>`, `true` is
`Expr<boolean>`.

**Design decision: `T` as the literal branch.** The `T` in
`Expr<T> = T | ...` means any value of type `T` is a valid
expression. For scalar types (`number`, `string`, `boolean`,
`null`) this is clean — literal JSON values ARE expression
leaves in the IR. For object types, this is more permissive:
any plain object matching `T` is silently an `Expr<T>`. This
is an intentional ergonomic choice — it avoids requiring a
`Literal()` wrapper for every embedded value. The tradeoff is
that when `T` is a structured object type, the boundary between
"data I'm embedding" and "object that accidentally matches" is
not enforced. If this becomes a source of confusion in practice,
the alternative is constraining the literal branch to
`JsonPrimitive` and requiring explicit `Literal<T>(value)`
wrappers for non-primitive values.

```typescript
interface Eval<T, TData = unknown> {
  readonly tisyn: "eval";
  readonly id: string;
  readonly data: TData;
  readonly T?: T; // phantom — stripped by JSON.stringify
}

interface Quote<T> {
  readonly tisyn: "quote";
  readonly expr: Expr<T>;
}

interface Ref<T> {
  readonly tisyn: "ref";
  readonly name: string;
  readonly T?: T; // phantom
}

interface TisynFn<A extends unknown[], R> {
  readonly tisyn: "fn";
  readonly params: readonly string[];
  readonly body: Expr<R>;
  readonly T?: (...args: A) => R; // phantom — function signature
}
```

**Phantom fields.** `Eval<T>`, `Ref<T>`, and `TisynFn<A, R>`
carry phantom `T?` fields — optional properties whose type
encodes result (or signature) information but whose value is
never assigned. `JSON.stringify` omits `undefined` properties,
so these have zero runtime cost. They exist solely to make
`Eval<number>` and `Eval<string>` incompatible types.

**`TisynFn<A, R>` carries the function signature.** `A` is a
tuple of parameter types, `R` is the return type. This allows
`Call` to enforce that its target is callable and that argument
types align. Parameter types are an authoring-layer assertion —
the IR itself stores parameter names as strings without type
information. The `A` types are not verified against scope.

**Relationship to grammar types.** Every `Eval<T>` is
structurally compatible with `EvalNode` (the phantom field is
optional). Every `Ref<T>` is compatible with `RefNode`. Code
that accepts `TisynExpr` accepts any `Expr<T>`. The authoring
types are a refinement, not a separate hierarchy.

**`Ref<T>` is an assertion.** When you write `Ref<number>("x")`,
you are asserting that `x` will hold a number at runtime. The
type system does not verify this. Scope correctness — whether
`x` is bound and what type it holds — is the compiler's and
kernel's responsibility.

### 3.6 How `T` Flows

Result types propagate through constructor signatures:

```
Literal 42                → Expr<number>
Ref<number>("x")          → Expr<number>
Add(Expr<number>, Expr<number>) → Expr<number>
If(Expr<boolean>, Expr<T>, Expr<T>) → Expr<T>
Eq(Expr<unknown>, Expr<unknown>) → Expr<boolean>
Let("x", Expr<A>, Expr<T>) → Expr<T>
While(Expr<boolean>, [..., Expr<T>]) → Expr<T>
Fn<A, R>(params, Expr<R>)  → Expr<(...args: A) => R>
Call(Expr<(...args: A) => R>, ...Expr<A[i]>) → Expr<R>
```

What this catches at compile time:

- `If(Literal("hello"), ...)` — condition must be `Expr<boolean>`
- `If(cond, Literal(1), Literal("two"))` — branches must agree
- `Add(Ref<string>("name"), Literal(2))` — operands must be
  `Expr<number>`
- `Call(Literal(42), ...)` — 42 is not callable
- `Call(fn, wrongTypedArg)` — argument types must match function
  signature

What this does NOT catch:

- Whether `Ref("x")` is bound in the current scope
- Whether `Ref<number>("x")` actually holds a number at runtime
- Whether a `Fn` body's free variables are satisfied at call sites
- Whether the parameter types asserted on `TisynFn<A, R>` match
  what the body actually does with the parameters

---

## 4. Constructor Functions (`@tisyn/ir/constructors.ts`)

### 4.1 Design Rules

**R1.** Every constructor returns a plain object. No classes.

**R2.** Every constructor's return value is JSON-round-trip safe.

**R3.** Structural operation constructors wrap data in Quote
automatically. The caller never writes Quote nodes manually.

**R4.** The standard external eval constructor (`Eval`) accepts
a data array. NOT wrapped in Quote.

**R5.** Compound external constructors (`All`, `Race`) wrap data
in Quote.

**R6.** Constructor return types use `Expr<T>` to carry result
types through composition. Phantom casts (`as Expr<T>`) are
permitted to establish result-type parameters. Structural casts
that hide shape mismatches are not.

### 4.2 Primitive Constructors

```typescript
function Ref<T>(name: string): Ref<T>;
function Q<T>(expr: Expr<T>): Quote<T>;
function Fn<A extends unknown[], R>(params: string[], body: Expr<R>): Expr<(...args: A) => R>;
```

Note: `Fn`'s parameter types `A` are asserted by the caller,
not inferred from the body. The body may reference parameters
via `Ref`, but the authoring layer does not verify that the
`Ref` types match `A`. This is consistent with the "result
types, not scope" principle.

### 4.3 Structural Operation Constructors

```typescript
// ── Binding ──

function Let<T>(name: string, value: Expr<unknown>, body: Expr<T>): Expr<T>;

function Seq<T>(...exprs: [...Expr<unknown>[], Expr<T>]): Expr<T>;

// ── Control flow ──

function If<T>(condition: Expr<boolean>, then_: Expr<T>, else_?: Expr<T>): Expr<T>;

function While<T>(condition: Expr<boolean>, exprs: [...Expr<unknown>[], Expr<T>]): Expr<T>;

function Call<A extends unknown[], R>(
  fn: Expr<(...args: A) => R>,
  ...args: { [K in keyof A]: Expr<A[K]> }
): Expr<R>;

// ── Property access ──

function Get<T>(obj: Expr<unknown>, key: string): Expr<T>;

// ── Arithmetic ──

function Add(a: Expr<number>, b: Expr<number>): Expr<number>;
function Sub(a: Expr<number>, b: Expr<number>): Expr<number>;
function Mul(a: Expr<number>, b: Expr<number>): Expr<number>;
function Div(a: Expr<number>, b: Expr<number>): Expr<number>;
function Mod(a: Expr<number>, b: Expr<number>): Expr<number>;
function Neg(a: Expr<number>): Expr<number>;

// ── Comparison ──

function Gt(a: Expr<number>, b: Expr<number>): Expr<boolean>;
function Gte(a: Expr<number>, b: Expr<number>): Expr<boolean>;
function Lt(a: Expr<number>, b: Expr<number>): Expr<boolean>;
function Lte(a: Expr<number>, b: Expr<number>): Expr<boolean>;
function Eq(a: Expr<unknown>, b: Expr<unknown>): Expr<boolean>;
function Neq(a: Expr<unknown>, b: Expr<unknown>): Expr<boolean>;

// ── Logical ──

function And<T>(a: Expr<T>, b: Expr<T>): Expr<T>;
function Or<T>(a: Expr<T>, b: Expr<T>): Expr<T>;
function Not(a: Expr<unknown>): Expr<boolean>;

// ── Data construction ──

function Construct<T extends Record<string, unknown>>(fields: {
  [K in keyof T]: Expr<T[K]>;
}): Expr<T>;

function Arr<T>(...items: Expr<T>[]): Expr<T[]>;

function Concat(...parts: Expr<unknown>[]): Expr<string>;

// ── Error ──

function Throw(message: Expr<string>): Expr<never>;
```

**`Call` requires a callable expression.** The `fn` parameter
is typed as `Expr<(...args: A) => R>`, not just `Expr<R>`. This
prevents `Call(Literal(42), ...)` at compile time — 42 is not
callable. Argument types are checked against the function's
declared parameter types. This is the primary reason `TisynFn`
carries `A` in addition to `R`.

**`And`/`Or` require matching operand types.** This is a typed
construction restriction, not a claim about full JavaScript-style
operand polymorphism. At runtime, `and`/`or` accept any values
and return operand values (Tisyn Spec §6.7). The `Expr<T>`
constraint requires both operands to agree on `T`, which is
stricter than the kernel's semantics. This is intentional —
mixed-type `and`/`or` at the authoring layer typically indicates
a mistake.

**`Arr` requires homogeneous items.** All items must share type
`T`. If heterogeneous tuple arrays are needed in the future,
this signature would need to be extended to a mapped-tuple
variant. This is a deliberate simplification for now.

### 4.4 External Eval Constructor

```typescript
function Eval<T>(id: string, data: Expr<unknown>[]): Expr<T>;
```

`T` is the expected return type of the external operation.
Callers specify it: `Eval<Order>("order-service.fetchOrder", [Ref("id")])`.
Data is a plain array, NOT wrapped in Quote.

### 4.5 Compound External Constructors

```typescript
function All<T extends unknown[]>(...exprs: { [K in keyof T]: Expr<T[K]> }): Expr<T>;

function Race<T>(...exprs: Expr<T>[]): Expr<T>;
```

`All` preserves per-child result types as a tuple.
`Race` requires all children to share a result type.

### 4.6 Implementation Pattern

Constructors produce structurally correct nodes. The phantom
`T` on `Eval<T>` is established by the function's return type
annotation, not by runtime values:

```typescript
function Let<T>(name: string, value: Expr<unknown>, body: Expr<T>): Expr<T> {
  return {
    tisyn: "eval",
    id: "let",
    data: { tisyn: "quote", expr: { name, value, body } },
  } as Expr<T>;
}
```

The `as Expr<T>` cast is necessary because the object literal
does not carry the phantom `T` field. This is safe — the cast
only assigns a phantom type parameter that has no runtime
representation. The structural shape (discriminant, id, data)
is verified by TypeScript without the cast.

Binary operations share a helper:

```typescript
function binary<T>(id: string, a: Expr<unknown>, b: Expr<unknown>): Expr<T> {
  return {
    tisyn: "eval",
    id,
    data: { tisyn: "quote", expr: { a, b } },
  } as Expr<T>;
}

function Add(a: Expr<number>, b: Expr<number>): Expr<number> {
  return binary<number>("add", a, b);
}
```

The type constraint (`Expr<number>` on Add's parameters) is
enforced by the public constructor's signature. The `binary`
helper is private — its widened parameter types are never
exposed to callers.

---

## 5. Classification (`@tisyn/ir/classify.ts`)

```typescript
function classify(id: string): "structural" | "external";

function isStructural(id: string): boolean;
function isExternal(id: string): boolean;

function isCompoundExternal(id: string): boolean;
```

Uses `STRUCTURAL_IDS` and `COMPOUND_EXTERNAL_IDS` from §3.4.

---

## 6. Traversal (`@tisyn/ir/walk.ts`, `fold.ts`, `transform.ts`)

Traversal utilities operate on `TisynExpr` (untyped grammar
types), not `Expr<T>`. Result types are erased during traversal
— they exist only during construction.

### 6.1 Walk — Raw Structural Traversal

A side-effect-only traversal that visits every node in the tree
including Quote contents and external eval data. This is the
foundational traversal — it imposes no semantic interpretation.

```typescript
type Walker = {
  enter?: (node: TisynExpr, path: string[]) => void;
  leave?: (node: TisynExpr, path: string[]) => void;
};

function walk(expr: TisynExpr, walker: Walker): void;
```

`path` is the sequence of keys/indices from root to current node.
Walk enters ALL children: Quote.expr, Eval.data (regardless of
structural vs external), Fn.body, array elements, object values.

### 6.2 The Fold

A catamorphism aligned to Tisyn's evaluation boundaries. It
recurses into structural operation children and produces a value
of type `A` at each node. The fold is semantics-aware: it uses
`classify()` and `unquote` logic to identify child positions.

**This is NOT a uniform catamorphism over all syntax.** The
`quote` handler receives raw `TisynExpr`, not folded children.
The `eval` handler (external) receives raw data, not folded
data. Other handlers receive folded `A` values. This asymmetry
is intentional — it mirrors the kernel's evaluation boundaries:
quoted data is inert until explicitly unquoted, and external
effect data is resolved at runtime, not structurally walked.
For a uniform structural traversal, use `walk` (§6.1).

```typescript
interface TisynAlgebra<A> {
  // Primitives
  literal(value: JsonPrimitive | JsonArray | JsonObject): A;
  ref(name: string): A;
  fn(params: string[], body: A): A;
  quote(expr: TisynExpr): A; // receives raw expr, not folded

  // Structural operations
  let(name: string, value: A, body: A): A;
  seq(exprs: A[]): A;
  if(condition: A, then_: A, else_: A | null): A;
  while(condition: A, body: A[]): A;
  call(fn: A, args: A[]): A;
  get(obj: A, key: string): A;

  // Binary
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

  // Error
  throw(message: A): A;

  // Structured error handling
  try(body: A, catchParam: string | undefined, catchBody: A | undefined, finally_: A | undefined): A;

  // External eval (opaque to the fold — data not recursed)
  eval(id: string, data: TisynExpr): A;
}

function fold<A>(expr: TisynExpr, algebra: TisynAlgebra<A>): A;
```

**Quote handling.** The fold does NOT recurse into Quote
contents. Quoted expressions are passed raw to the `quote`
handler. This matches the kernel's evaluation semantics.

**External eval handling.** External eval data is NOT recursed
into. The data is passed as-is to the `eval` handler. This
matches the kernel's `resolve` boundary.

**When you need to recurse into everything** (Quote contents,
external data), use `walk` instead. The fold and walk serve
different purposes: fold follows kernel evaluation structure,
walk follows raw syntax.

### 6.3 Partial Algebra

```typescript
function foldWith<A>(
  expr: TisynExpr,
  base: TisynAlgebra<A>,
  overrides: Partial<TisynAlgebra<A>>,
): A;

function defaultAlgebra<A>(zero: () => A): TisynAlgebra<A>;
```

### 6.4 The Transformer

```typescript
type Visitor = {
  [K in "ref" | "fn" | "eval" | "quote" | "literal"]?: (
    node: NodeOfKind<K>,
  ) => TisynExpr | undefined;
} & {
  [K in StructuralId]?: (node: StructuralNodeOfKind<K>) => TisynExpr | undefined;
};

function transform(expr: TisynExpr, visitor: Visitor): TisynExpr;
```

If a visitor returns `undefined`, the transformer recurses into
children. If it returns a `TisynExpr`, that replaces the node
(single pass, no re-visiting).

### 6.5 Collect Utilities

Built on `walk` (raw traversal):

```typescript
function collectRefs(expr: TisynExpr): string[];
function collectExternalIds(expr: TisynExpr): string[];
function collectFreeRefs(expr: TisynExpr): string[];
```

---

## 7. Print and Decompile (`@tisyn/ir/print.ts`, `decompile.ts`)

### 7.1 `print` — Constructor-Call Representation

```typescript
function print(expr: TisynExpr, options?: PrintOptions): string;

interface PrintOptions {
  indent?: number; // spaces per level, default 2
  maxWidth?: number; // target line width, default 80
  compact?: boolean; // single-line when fits, default true
}
```

Produces a constructor-call representation for debugging. NOT
valid TypeScript.

### 7.2 `decompile` — TypeScript Source Representation

```typescript
function decompile(expr: TisynExpr, options?: DecompileOptions): string;

interface DecompileOptions {
  indent?: number;
  typeAnnotations?: boolean;
  namedExport?: string;
}
```

Produces readable TypeScript. Semantically equivalent to the
original source, not byte-identical.

**Reconstruction rules:**

- Let-chains flatten to sequential `const` statements
- Recursive `Fn` + `Call` (compiler Case B) reconstructs to
  `while` with `return`
- External evals become `yield*` statements
- `__discard_N` bindings become bare `yield*` (no variable)
- Dotted IDs split into PascalCase agent + method call

---

## 8. Validation (`@tisyn/validate`)

### 8.1 Purpose

Validate IR received from untrusted sources.

### 8.2 Validation Levels

**Level 1 — Grammar.** Node structure correct. Required fields
present and typed.

**Level 2 — Single-quote invariant.** Structural Eval data is
Quote. No Quote at evaluation positions.

**Level 3 — Scope consistency.** Every Ref bound by enclosing
Let or Fn.

### 8.3 Interface

```typescript
type ValidationError = {
  level: 1 | 2 | 3;
  path: string[];
  message: string;
  code: string;
};

type ValidationResult = { ok: true; node: TisynExpr } | { ok: false; errors: ValidationError[] };

function validateGrammar(json: unknown): ValidationResult;
function validateScope(expr: TisynExpr): ValidationError[];
function validateIr(json: unknown, options?: { scope?: boolean }): ValidationResult;
```

`validateIr(json)` runs Levels 1 + 2 by default. With
`{ scope: true }`, runs all three levels. Scope is opt-in
because it requires full tree traversal and the kernel catches
unbound Refs at runtime.

### 8.4 Schema Library Choice

TypeBox internally. Schemas ARE JSON Schema Draft 7 objects.
`TypeCompiler` JIT-compiles validation. Implementation detail —
does not leak into other packages.

### 8.5 Schema ↔ Type Relationship

TypeBox schemas in `schemas.ts` are hand-maintained alongside
grammar types in `@tisyn/ir/types.ts`. Each schema corresponds
to one grammar type. CI tests SHOULD verify TypeBox
`Static<typeof schema>` matches the `@tisyn/ir` type.

---

## 9. Agent Types (`@tisyn/protocol`)

```typescript
type AgentOperations = Record<string, (...args: any[]) => Operation<any>>;

type AgentClient<T extends AgentOperations> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Operation<infer R>
    ? (...args: A) => Workflow<R>
    : never;
};

function Agent<T extends AgentOperations>(id: string, operations: T): AgentDefinition<T>;
```

---

## 10. What `@tisyn/shared` Becomes

| Current content             | New location      |
| --------------------------- | ----------------- |
| IR node types               | `@tisyn/ir`       |
| `classify` function         | `@tisyn/ir`       |
| Wire protocol message types | `@tisyn/protocol` |
| Journal event types         | `@tisyn/runtime`  |
| Agent definition types      | `@tisyn/protocol` |
| Validation logic            | `@tisyn/validate` |
| Utility functions on IR     | `@tisyn/ir`       |

---

## 11. Public API Surface

### 11.1 `@tisyn/ir` Exports

```typescript
// Grammar types (untyped, for traversal/validation/kernel)
export type {
  TisynExpr,
  TisynTaggedNode,
  TisynLiteral,
  EvalNode,
  QuoteNode,
  RefNode,
  FnNode,
  JsonPrimitive,
  JsonArray,
  JsonObject,
};

// Authoring types (result-typed, for construction)
export type { Expr, Eval, Quote, Ref, TisynFn };

// Data shapes
export type {
  LetShape,
  SeqShape,
  IfShape,
  WhileShape,
  CallShape,
  GetShape,
  BinaryShape,
  UnaryShape,
  ConstructShape,
  ArrayShape,
  ConcatShape,
  ThrowShape,
  AllShape,
  RaceShape,
};

// Narrowed structural node types
export type {
  LetNode,
  SeqNode,
  IfNode,
  WhileNode,
  CallNode,
  GetNode,
  AddNode,
  SubNode,
  MulNode,
  DivNode,
  ModNode,
  NegNode,
  GtNode,
  GteNode,
  LtNode,
  LteNode,
  EqNode,
  NeqNode,
  AndNode,
  OrNode,
  NotNode,
  ConstructNode,
  ArrayNode,
  ConcatNode,
  ThrowNode,
  AllNode,
  RaceNode,
};

// Derived unions
export type {
  StructuralNode,
  CompoundExternalNode,
  StandardExternalEvalNode,
  StructuralId,
  CompoundExternalId,
};

// Classification
export {
  STRUCTURAL_IDS,
  COMPOUND_EXTERNAL_IDS,
  classify,
  isStructural,
  isExternal,
  isCompoundExternal,
};

// Constructors (return Expr<T>)
export {
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
  Throw,
  Eval,
  All,
  Race,
};

// Traversal (operates on TisynExpr)
export type { TisynAlgebra, Visitor, Walker };
export { walk, fold, foldWith, defaultAlgebra, transform };
export { collectRefs, collectExternalIds, collectFreeRefs };

// Print and decompile
export type { PrintOptions, DecompileOptions };
export { print, decompile };
```

### 11.2 `@tisyn/validate` Exports

```typescript
export type { ValidationError, ValidationResult };
export { validateGrammar, validateScope, validateIr };
```

### 11.3 `@tisyn/protocol` Exports

```typescript
export type {
  AgentConfig,
  AgentOperations,
  AgentDefinition,
  AgentClient,
  ExecuteRequest,
  ExecuteResponse,
  CancelNotification,
  ProgressNotification,
  ShutdownNotification,
  InitializeRequest,
};
export { Agent };
```

### 11.4 `@tisyn/runtime` Exports

```typescript
export type { YieldEvent, CloseEvent, EventResult, ReplayIndex, Task, TaskState };
```

---

## 12. Implementation Priority

### Phase 1 — Foundation

1. `@tisyn/ir/types.ts` — exact grammar types and data shapes
2. `@tisyn/ir/expr.ts` — result-typed authoring types
3. `@tisyn/ir/derived.ts` — convenience unions, ID sets
4. `@tisyn/ir/constructors.ts` — all 30+ constructor functions
5. `@tisyn/ir/classify.ts` — structural/external classification

### Phase 2 — Traversal and Output

6. `@tisyn/ir/walk.ts` — raw structural traversal
7. `@tisyn/ir/fold.ts` — kernel-aware fold
8. `@tisyn/ir/transform.ts` — tree transformer
9. `@tisyn/ir/print.ts` — constructor-call debug representation
10. `@tisyn/ir/decompile.ts` — TypeScript source representation
11. `collectRefs`, `collectFreeRefs`, etc.

### Phase 3 — Boundaries

12. `@tisyn/validate` — TypeBox schemas + validation functions
13. `@tisyn/protocol` — wire protocol and agent types
14. `@tisyn/runtime` — journal events, replay, task types

---

## Appendix A: Full Constructor Example

```typescript
type R = Result; // workflow return type

const pollJob = Fn<[string], R>(
  ["jobId"],
  Let(
    "config",
    Eval<RetryConfig>("config-service.getRetryConfig", []),
    Let(
      "__loop_0",
      Fn<[], R>(
        [],
        Let(
          "status",
          Eval<JobStatus>("job-service.checkStatus", [Ref("jobId")]),
          If(
            Eq(Get<string>(Ref("status"), "state"), "complete"),
            Eval<R>("job-service.getResult", [Ref("jobId")]),
            If(
              Eq(Get<string>(Ref("status"), "state"), "failed"),
              Throw("Job failed"),
              Let(
                "__discard_0",
                Eval<void>("sleep", [Get<number>(Ref("config"), "intervalMs")]),
                Call(Ref<() => R>("__loop_0")),
              ),
            ),
          ),
        ),
      ),
      Call(Ref<() => R>("__loop_0")),
    ),
  ),
);
```

Type annotations on `Eval<T>`, `Ref<T>`, and `Get<T>` are
explicit here for clarity. Note how `Fn<[], R>` produces
`Expr<() => R>` and `Call` requires `Expr<() => R>` as its
first argument -- `Call(Literal(42))` would be a compile error.

---

## Appendix B: Decompile Output

`decompile(pollJob, { namedExport: "pollJob" })` produces:

```typescript
function* pollJob(jobId) {
  const config = yield* ConfigService().getRetryConfig();
  while (true) {
    const status = yield* JobService().checkStatus(jobId);
    if (status.state === "complete") {
      return yield* JobService().getResult(jobId);
    }
    if (status.state === "failed") {
      throw new Error("Job failed");
    }
    yield* sleep(config.intervalMs);
  }
}
```

---

## Appendix C: Fold Example — Free Variable Collector

```typescript
const freeVars = foldWith<Set<string>>(expr, {
  ...defaultAlgebra(() => new Set()),
  ref: (name) => new Set([name]),
  let: (name, value, body) => {
    const result = new Set([...value, ...body]);
    result.delete(name);
    return result;
  },
  fn: (params, body) => {
    const result = new Set(body);
    for (const p of params) result.delete(p);
    return result;
  },
});
```

---

## Appendix D: Transform Example — Inline Refs

```typescript
const inlined = transform(expr, {
  ref: (node) => (node.name === "x" ? 42 : undefined),
});
```
