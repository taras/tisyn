# `@tisyn/validate`

Boundary validation for Tisyn IR, including `MalformedIR` and exported schema values.

Use this package when IR may come from an external compiler, user input, persisted data, or another process.

## Main exports

- `validateGrammar()`
- `validateIr()`
- `assertValidIr()`
- `MalformedIR`
- schema values like `tisynExprSchema`

## Example

```ts
import { assertValidIr } from "@tisyn/validate";

assertValidIr(maybeExternalIr);
```

If validation fails, `assertValidIr()` throws `MalformedIR`.

## Relationship to the rest of Tisyn

- [`@tisyn/kernel`](../kernel/README.md) re-exports `MalformedIR` but no longer owns validation.
- [`@tisyn/runtime`](../runtime/README.md) validates IR before execution.
- [`@tisyn/compiler`](../compiler/README.md) validates compiled output by default.
- [`@tisyn/ir`](../ir/README.md) defines the node shapes that validation checks.
