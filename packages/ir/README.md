# `@tisyn/ir`

The Tisyn expression model: values, tagged nodes, constructors, walkers, classifiers, and printers.

Use this package when you want to construct or inspect Tisyn programs directly.

## Main exports

- expression and value types like `TisynExpr` and `Val`
- constructors like `Q`, `Ref`, `Fn`, `Let`, `Call`, `Add`, `All`, and `Race`
- guards and classifiers like `classifyNode()` and `isStructural()`
- helpers like `walk()`, `transform()`, `print()`, and `decompile()`

## Example

```ts
import { Add, Q } from "@tisyn/ir";

const ir = Add(Q(20), Q(22));
```

## Relationship to the rest of Tisyn

- [`@tisyn/validate`](../validate/README.md) validates IR trees before execution or compilation.
- [`@tisyn/kernel`](../kernel/README.md) gives IR semantics.
- [`@tisyn/compiler`](../compiler/README.md) produces IR from TypeScript source.
- [`@tisyn/runtime`](../runtime/README.md) executes IR durably.
