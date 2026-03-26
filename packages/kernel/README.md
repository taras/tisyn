# `@tisyn/kernel`

`@tisyn/kernel` defines the low-level semantics of Tisyn evaluation. It resolves references, evaluates structural IR, describes yielded effects, and defines the durable event shapes that the runtime persists.

## Where It Fits

This package sits between validated IR and durable execution.

- `@tisyn/validate` guards the boundary before the kernel sees input.
- `@tisyn/kernel` explains what each node means and what event shape evaluation produces.
- `@tisyn/runtime` builds replay, journaling, and dispatch on top of those semantics.

Use `@tisyn/kernel` when you need the evaluator itself, not the full durable runtime.

## Core Concepts

- `evaluate()`: the evaluator for structural IR
- `resolve()`: resolves references in an environment
- `unquote()`: turns quoted values back into executable expressions where appropriate
- `Env`: lexical environment abstraction
- durable events like `YieldEvent` and `CloseEvent`
- runtime errors like `UnboundVariable`, `NotCallable`, and `DivisionByZero`

## Main APIs

The public surface from `src/index.ts` is:

- `evaluate`
- `classify`
- `isStructural`
- `isCompoundExternal`
- `resolve`
- `unquote`
- environment helpers:
  - `Env`
  - `EMPTY_ENV`
  - `lookup`
  - `extend`
  - `extendMulti`
  - `envFromRecord`
- validation error re-export:
  - `MalformedIR`
- runtime errors:
  - `UnboundVariable`
  - `NotCallable`
  - `ArityMismatch`
  - `TypeError`
  - `DivisionByZero`
  - `ExplicitThrow`
- event types:
  - `EffectDescription`
  - `EventResult`
  - `YieldEvent`
  - `CloseEvent`
  - `DurableEvent`
  - `EffectDescriptor`
- helpers:
  - `canonical`
  - `parseEffectId`

## Example

```ts
import { evaluate, envFromRecord } from "@tisyn/kernel";

const kernel = evaluate(ir, envFromRecord({ value: 21 }));
```

At this layer, yielded effects are described, not dispatched. That is one of the main differences between kernel and runtime.

## Relationship to the Rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the nodes the kernel evaluates.
- [`@tisyn/validate`](../validate/README.md) validates IR before execution.
- [`@tisyn/runtime`](../runtime/README.md) uses kernel events as the basis for replay and durable execution.
- [`@tisyn/durable-streams`](../durable-streams/README.md) stores the kernel's durable event stream.

## Boundaries

`@tisyn/kernel` owns:

- structural evaluation semantics
- environment semantics
- durable event definitions
- low-level runtime errors

It does not own:

- journaling
- replay persistence
- agent dispatch
- remote execution
