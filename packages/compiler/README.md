# `@tisyn/compiler`

Compile generator-shaped TypeScript source into Tisyn IR.

Use this package when you want to produce IR from source code instead of constructing nodes by hand.

## Main exports

- `compile()`
- `compileOne()`
- `CompileError`
- helper exports like `toAgentId()` and IR builder utilities

## Example

```ts
import { compileOne } from "@tisyn/compiler";

const ir = compileOne(`
  export function* double(value: number) {
    return value * 2;
  }
`);
```

By default, compiled output is validated with `@tisyn/validate` before it is returned.

## Relationship to the rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the target syntax tree.
- [`@tisyn/validate`](../validate/README.md) validates emitted IR.
- [`@tisyn/runtime`](../runtime/README.md) executes the compiled result.
