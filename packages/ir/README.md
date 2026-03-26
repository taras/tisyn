# `@tisyn/ir`

`@tisyn/ir` is the shared language of Tisyn. It defines the node shapes, value types, constructors, traversal helpers, and printing/decompilation utilities that every other package relies on.

## Where It Fits

This package is the common representation layer for the whole system.

- `@tisyn/compiler` produces IR.
- `@tisyn/validate` checks IR.
- `@tisyn/kernel` gives IR evaluation semantics.
- `@tisyn/runtime` executes IR durably.
- `@tisyn/protocol` and `@tisyn/transport` carry IR-compatible values across boundaries.

If you need a package that almost every other Tisyn package depends on, this is it.

## Core Concepts

- `TisynExpr`: the broad expression type
- `Val` / `Json`: runtime values that can flow through environments and protocols
- `TisynFn`: function-shaped IR value
- constructor helpers like `Fn`, `Ref`, `Let`, `Call`, `Eval`, `All`, and `Race`
- traversal helpers like `walk()` and `transform()`
- inspection helpers like `classifyNode()`, `collectRefs()`, and `print()`

## Main APIs

The surface is intentionally broad, but it groups into a few jobs.

### Types and values

- `Json`
- `Val`
- `TisynExpr`
- `Expr`
- `TisynFn`
- `IrInput`

### Constructors

- `Q`
- `Ref`
- `Fn`
- `Let`
- `Seq`
- `If`
- `While`
- `Call`
- `Get`
- arithmetic and boolean nodes like `Add`, `Eq`, `And`, `Not`
- data constructors like `Construct`, `Arr`, `Concat`
- effect/external nodes like `Eval`, `All`, `Race`

### Classification and guards

- `classifyNode`
- `classify`
- `isStructural`
- `isExternal`
- `isCompoundExternal`
- `isEvalNode`
- `isFnNode`

### Traversal and transformation

- `walk`
- `fold`
- `foldWith`
- `transform`
- `collectRefs`
- `collectExternalIds`
- `collectFreeRefs`

### Developer tooling

- `print`
- `decompile`

## Example

```ts
import { Add, Q } from "@tisyn/ir";

const ir = Add(Q(20), Q(22));
```

Function-shaped IR is just data too:

```ts
import { Fn, Ref, Add } from "@tisyn/ir";

const double = Fn(["x"], Add(Ref("x"), Ref("x")));
```

## Relationship to the Rest of Tisyn

- [`@tisyn/compiler`](../compiler/README.md) lowers authored workflows into these nodes.
- [`@tisyn/validate`](../validate/README.md) checks that incoming trees match the allowed grammar.
- [`@tisyn/kernel`](../kernel/README.md) interprets the nodes.
- [`@tisyn/runtime`](../runtime/README.md) wraps kernel evaluation with replay and dispatch.

## Boundaries

`@tisyn/ir` is intentionally representation-focused. It does not define:

- validation policy
- execution semantics
- durable storage
- remoting protocol

It gives those packages a common vocabulary.
