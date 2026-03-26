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

- `Q`: Quote an expression so it is treated as IR data instead of something to evaluate immediately.
- `Ref`: Reference a named value from the current environment.
- `Fn`: Build a function-shaped IR value with positional parameters and a body expression.
- `Let`: Bind an intermediate value to a name and continue evaluation in the extended environment.
- `Seq`: Evaluate a series of expressions in order and return the last result.
- `If`: Conditionally choose between two expressions based on a boolean condition.
- `While`: Represent a loop that keeps evaluating a body while a condition remains true.
- `Call`: Invoke a function-shaped IR value with zero or more IR arguments.
- `Get`: Read a named property from an object expression.
- `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Neg`, `Gt`, `Gte`, `Lt`, `Lte`, `Eq`, `Neq`, `And`, `Or`, `Not`: Build arithmetic, comparison, and boolean operations as IR nodes.
- `Construct`, `Arr`, `Concat`: Build object, array, and string-concatenation expressions from IR inputs.
- `Throw`: Represent an expression that raises an error with the given message.
- `Eval`: Invoke an external operation or structural form by id with a single payload expression.
- `All`: Evaluate multiple expressions concurrently and collect all of their results.
- `Race`: Evaluate multiple expressions concurrently and resolve with the first one to complete.

### Classification and guards

- `classifyNode`: Categorize an unknown value as a literal, IR node, object-shaped IR, or non-IR value.
- `classify`: Classify an eval id as structural or external.
- `isStructural`: Check whether an eval id names a structural form handled by the kernel.
- `isExternal`: Check whether an eval id names a non-structural external operation.
- `isCompoundExternal`: Check whether an eval id names a compound external form such as `all` or `race`.
- `isEvalNode`: Narrow an unknown value to an eval node.
- `isFnNode`: Narrow an unknown value to a function-shaped IR node.

### Traversal and transformation

- `walk`: Visit every node in an IR tree with enter/leave hooks and path information.
- `fold`: Reduce an IR tree to a single value using an algebra over node shapes.
- `foldWith`: Run a fold with a partially specified algebra layered on top of defaults.
- `transform`: Produce a rewritten IR tree by replacing nodes during traversal.
- `collectRefs`: Gather all referenced names that appear anywhere in an expression.
- `collectExternalIds`: Gather all external eval ids used in an expression tree.
- `collectFreeRefs`: Gather referenced names that are not bound locally by `Fn` or `Let`.

### Developer tooling

- `print`: Render IR into a stable constructor-style string for debugging and tests.
- `decompile`: Render IR back into readable TypeScript-like source for inspection.

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
