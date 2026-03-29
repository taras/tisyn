# `@tisyn/kernel`

`@tisyn/kernel` defines the core evaluation semantics of Tisyn. It evaluates structural IR, resolves lexical references, describes yielded effects, and defines the durable event shapes that higher layers persist and replay.

This package is the execution model beneath the runtime. It explains what a Tisyn program means before journaling, dispatch, or recovery are added on top.

## Where It Fits

`@tisyn/kernel` sits between validated IR and the full durable runtime:

- `@tisyn/validate` ensures malformed input does not cross the trust boundary
- `@tisyn/kernel` defines how valid IR is evaluated and what event shapes evaluation can produce
- `@tisyn/runtime` builds journaling, replay, dispatch, and continuation on top of those semantics

Use `@tisyn/kernel` when you need the evaluator itself, not the full durable execution stack.

## What This Package Does

`@tisyn/kernel` is responsible for:

- evaluating structural IR
- resolving references through lexical environments
- converting quoted values back into executable expressions where kernel rules allow it
- describing yielded effects without dispatching them
- defining the durable event shapes consumed by the runtime
- reporting low-level evaluation errors

It does **not** handle:

- journaling
- replay persistence
- agent dispatch
- remote execution

## Core Concepts

### `evaluate()`

The main evaluator for structural IR. It steps through evaluation until it produces one of three outcomes:

- a value
- a yield
- a close result

At this layer, effects are described, not executed.

### `resolve()`

Looks up a named reference in a lexical environment.

### `unquote()`

Turns quoted values back into executable expressions where the kernel semantics permit it.

### `Env`

The lexical environment abstraction used during evaluation.

### Durable events

The kernel defines the event shapes that higher layers persist, including:

- `YieldEvent`
- `CloseEvent`

These are the semantic boundary between evaluation and durable runtime behavior.

### Runtime errors

The kernel also defines low-level execution errors such as:

- `UnboundVariable`
- `NotCallable`
- `ArityMismatch`
- `TypeError`
- `DivisionByZero`
- `ExplicitThrow`

## Main APIs

The public surface exported from `src/index.ts` includes the following:

### Evaluation

- `evaluate` — evaluate structural IR until a value, yield, or close result is produced
- `classify` — classify an eval id as structural or external
- `isStructural` — check whether an eval id is handled directly by kernel semantics
- `isCompoundExternal` — check whether an eval id is a compound external form such as `all` or `race`

### Environment and reference resolution

- `resolve` — look up a named reference in an environment
- `unquote` — convert quoted values back into executable expressions where kernel rules allow it
- `Env` — lexical environment abstraction used during evaluation
- `EMPTY_ENV` — canonical empty environment
- `lookup` — read a bound value from an environment by name
- `extend` — create a child environment with one additional binding
- `extendMulti` — create a child environment with multiple bindings at once
- `envFromRecord` — build an environment from a plain record of values

### Validation error re-export

- `MalformedIR` — invalid-IR error raised when malformed input crosses a trust boundary

### Runtime errors

- `UnboundVariable` — reference with no matching binding
- `NotCallable` — attempted call of a non-callable value
- `ArityMismatch` — call with the wrong number of arguments
- `TypeError` — structural operation given values of the wrong kind
- `DivisionByZero` — division or modulo by zero
- `ExplicitThrow` — application-level error raised by `Throw(...)`
- `EffectError` — error raised when a dispatched effect fails

### Error helpers

- `isCatchable` — returns true if an error can be caught by a `try` node
- `errorToValue` — converts a caught error to its string message value

### Event and effect types

- `EffectDescription` — describes a yielded effect before dispatch or persistence
- `EventResult` — evaluator outcome shape consumed by the runtime
- `YieldEvent` — persisted effect yield and its eventual result
- `CloseEvent` — persisted terminal execution result
- `DurableEvent` — union of all event types that can appear in the durable stream
- `EffectDescriptor` — canonical structural shape of an effect descriptor

### Helpers

- `canonical` — produce a stable canonical representation for event payloads and comparisons
- `parseEffectId` — split an effect id into its agent and operation parts

## Example

```ts
import { evaluate, envFromRecord } from "@tisyn/kernel";

const kernel = evaluate(ir, envFromRecord({ value: 21 }));
```

At the kernel layer, yielded effects are only described. Dispatch, persistence, and replay are handled by higher layers.

## Relationship to the Rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the nodes the kernel evaluates
- [`@tisyn/validate`](../validate/README.md) validates IR before execution
- [`@tisyn/runtime`](../runtime/README.md) uses kernel events as the basis for replay and durable execution
- [`@tisyn/durable-streams`](../durable-streams/README.md) stores the durable event stream produced above this layer

## Boundaries

`@tisyn/kernel` owns:

- structural evaluation semantics
- lexical environment semantics
- durable event definitions
- low-level evaluation errors

`@tisyn/kernel` does not own:

- journaling
- replay persistence
- agent dispatch
- remote execution

## In One Sentence

`@tisyn/kernel` is the semantic core of Tisyn: it evaluates valid IR, describes effects, and defines the durable event shapes that the runtime builds on.
