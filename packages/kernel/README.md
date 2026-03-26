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

- `evaluate`: Step through IR evaluation until a value, yield, or close result is produced.
- `classify`: Classify an eval id as structural or external.
- `isStructural`: Check whether an eval id is handled directly by kernel semantics.
- `isCompoundExternal`: Check whether an eval id is a compound external form such as `all` or `race`.
- `resolve`: Look up a named reference in an environment.
- `unquote`: Convert quoted values back into executable expressions where kernel rules allow it.
- environment helpers:
  - `Env`: Represent the lexical environment abstraction used during evaluation.
  - `EMPTY_ENV`: Provide the canonical empty environment value.
  - `lookup`: Read a bound value from an environment by name.
  - `extend`: Create a child environment with one additional binding.
  - `extendMulti`: Create a child environment with multiple bindings at once.
  - `envFromRecord`: Build an environment from a plain record of values.
- validation error re-export:
  - `MalformedIR`: Represent the invalid-IR error raised when malformed input crosses a trust boundary.
- runtime errors:
  - `UnboundVariable`: Report an attempt to evaluate a reference with no matching binding.
  - `NotCallable`: Report an attempt to call a value that is not function-shaped.
  - `ArityMismatch`: Report a call whose argument count does not match the function shape.
  - `TypeError`: Report a structural operation receiving values of the wrong kind.
  - `DivisionByZero`: Report division or modulo by zero in structural arithmetic.
  - `ExplicitThrow`: Report a `Throw(...)` node raising an application-level error.
- event types:
  - `EffectDescription`: Describe a yielded effect before dispatch or persistence.
  - `EventResult`: Represent the evaluator outcome shape consumed by the runtime.
  - `YieldEvent`: Represent a persisted effect yield and its eventual result.
  - `CloseEvent`: Represent a persisted terminal execution result.
  - `DurableEvent`: Union together all event types that can appear in the durable stream.
  - `EffectDescriptor`: Name the canonical structural shape of an effect descriptor.
- helpers:
  - `canonical`: Produce a stable canonical representation for event payloads and comparisons.
  - `parseEffectId`: Split an effect id into its agent and operation parts.

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
