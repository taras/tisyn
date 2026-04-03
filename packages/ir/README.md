# `@tisyn/ir`

`@tisyn/ir` defines the intermediate representation at the heart of Tisyn.

It is the shared program format that the rest of the system agrees on: the compiler produces it, the validator checks it, the kernel interprets it, the runtime executes it, and protocols move its values across boundaries.

If Tisyn has a common language, this is it.

## Where It Fits

`@tisyn/ir` is the representation layer for the whole system.

- `@tisyn/compiler` lowers authored workflows into IR
- `@tisyn/validate` checks that IR is well-formed
- `@tisyn/kernel` defines how IR evaluates
- `@tisyn/runtime` executes IR durably
- `@tisyn/protocol` and `@tisyn/transport` move IR-compatible values across boundaries

Almost every other Tisyn package depends on this one, directly or indirectly.

## What It Contains

This package provides the core building blocks for working with Tisyn programs as data:

- expression and value types such as `TisynExpr`, `Val`, `Json`, `TisynFn`, `ScopeNode`, `ScopeShape`, `TimeboxNode`, and `TimeboxShape`
- constructor helpers such as `Fn`, `Ref`, `Let`, `Call`, `Try`, `Eval`, `All`, `Race`, and `Timebox`
- traversal and transformation utilities such as `walk()`, `fold()`, and `transform()`
- inspection and developer tooling such as `classifyNode()`, `collectRefs()`, `print()`, and `decompile()`, including compound externals like `timebox`

## Core Concepts

### Expressions are data

A Tisyn program is represented as a tree of JSON-compatible expression nodes. `TisynExpr` is the broad union of those nodes and literals.

That makes workflows explicit, serializable, inspectable, and transportable across package and process boundaries.

### Functions are data too

`TisynFn` represents a function-shaped IR value with parameter names and a body expression. Function values are not opaque host-language closures; they remain part of the IR.

### Values stay boundary-friendly

`Json` represents plain JSON-compatible values. `Val` represents the broader runtime value domain that environments and protocols can accept.

These types define what can safely move through Tisyn systems.

## Main APIs

The API surface is broad, but it falls into a few clear groups.

### Types and values

- `Json` — plain JSON-compatible values
- `Val` — runtime values accepted by environments and protocols
- `TisynExpr` — the full union of legal Tisyn expressions and literals
- `Expr` — typed expression input accepted by constructor helpers
- `TisynFn` — a function-shaped IR value with parameters and a body
- `IrInput` — validated input shapes accepted by IR-consuming APIs
- `ScopeShape` — the payload shape for a `scope` eval node: `{ handler, bindings, body }`
- `ScopeNode` — an eval node with `id: "scope"` carrying a `ScopeShape` in a Quote
- `TimeboxShape` — the payload shape for a `timebox` eval node: `{ duration, body }`
- `TimeboxNode` — an eval node with `id: "timebox"` carrying a `TimeboxShape` in a Quote

### Constructors

Use these to build IR programmatically:

- `Q` — quote an expression as IR data
- `Ref` — reference a named value from the current environment
- `Fn` — construct a function-shaped IR value
- `Let` — bind a value and continue in an extended environment
- `Seq` — evaluate a series of expressions in order
- `If` — choose between two expressions conditionally
- `While` — represent looping while a condition remains true
- `Call` — invoke a function-shaped IR value
- `Get` — read a named property from an object expression
- `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Neg`
- `Gt`, `Gte`, `Lt`, `Lte`, `Eq`, `Neq`
- `And`, `Or`, `Not`
- `Construct`, `Arr`, `Concat`
- `Throw`
- `Try` — handle exceptions with optional catch and finally clauses
- `Eval` — invoke an external operation or structural form by id
- `All` — evaluate multiple expressions concurrently and collect their results
- `Race` — evaluate multiple expressions concurrently and resolve with the first result
- `Resource` — declare a resource with an init/cleanup lifecycle and a provided value
- `Provide` — yield a value from a resource body to its parent
- `Timebox` — declare a deadline-bounded compound external with a duration expression and body

### Classification and guards

Use these when inspecting unknown values or narrowing types:

- `classifyNode`
- `classify`
- `isStructural`
- `isExternal`
- `isCompoundExternal`
- `isEvalNode`
- `isFnNode`

### Traversal and transformation

Use these to analyze or rewrite IR trees:

- `walk` — visit every node with enter/leave hooks
- `fold` — reduce an IR tree to a single value
- `foldWith` — extend a default fold with custom behavior
- `transform` — rewrite an IR tree during traversal
- `collectRefs` — gather referenced names
- `collectExternalIds` — gather external eval ids
- `collectFreeRefs` — gather references not bound locally by `Fn` or `Let`

### Developer tooling

Use these for debugging, testing, and inspection:

- `print` — stable constructor-style rendering, including `timebox(...)`
- `decompile` — readable TypeScript-like rendering, including `timebox(...)`

## Example

```ts
import { Add, Q } from "@tisyn/ir";

const ir = Add(Q(20), Q(22));
```

Function-shaped IR values are data too:

```ts
import { Add, Fn, Ref } from "@tisyn/ir";

const double = Fn(["x"], Add(Ref("x"), Ref("x")));
```

Compound externals can be built directly too:

```ts
import { Timebox } from "@tisyn/ir";

const bounded = Timebox(5000, "done");
```

## Relationship to the Rest of Tisyn

- [`@tisyn/compiler`](../compiler/README.md) lowers authored workflows into IR
- [`@tisyn/validate`](../validate/README.md) checks that trees match the allowed grammar
- [`@tisyn/kernel`](../kernel/README.md) interprets the nodes
- [`@tisyn/runtime`](../runtime/README.md) executes them with replay and dispatch

## Boundaries

`@tisyn/ir` is intentionally focused on representation. It does not define:

- validation policy
- execution semantics
- durable storage
- remoting protocol

Its job is to give the rest of Tisyn a common program format and vocabulary.
