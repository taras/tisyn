# `@tisyn/kernel`

Core Tisyn semantics: evaluation, environments, durable event types, and fundamental runtime errors.

Use this package when you need the low-level execution model rather than the full durable runtime.

## Main exports

- `evaluate()`
- `resolve()`
- `unquote()`
- environment helpers like `EMPTY_ENV`, `lookup()`, and `envFromRecord()`
- durable event and effect types like `YieldEvent`, `CloseEvent`, and `EffectDescription`
- runtime errors like `UnboundVariable`, `NotCallable`, and `DivisionByZero`

## Example

```ts
import { evaluate, envFromRecord } from "@tisyn/kernel";

const kernel = evaluate(ir, envFromRecord({ value: 21 }));
```

## Relationship to the rest of Tisyn

- [`@tisyn/runtime`](../runtime/README.md) builds durable execution on top of the kernel.
- [`@tisyn/durable-streams`](../durable-streams/README.md) stores the kernel events emitted during execution.
- [`@tisyn/validate`](../validate/README.md) validates IR before the kernel sees it.
