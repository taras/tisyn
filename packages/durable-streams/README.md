# `@tisyn/durable-streams`

`@tisyn/durable-streams` defines the append-only event stream abstraction that makes durable Tisyn execution possible. The runtime records yield and close events into a `DurableStream`, and replay uses those events to resume execution deterministically.

## Where It Fits

This package is the storage boundary underneath durable execution.

- The kernel defines the event shapes.
- The runtime appends and replays those events.
- This package provides the storage interface and replay indexing utilities.

If `@tisyn/runtime` is responsible for durable execution, `@tisyn/durable-streams` is responsible for durable persistence and lookup.

## Core Concepts

- `DurableStream`: append-only event storage interface
- `InMemoryStream`: test-friendly in-memory implementation
- `ReplayIndex`: helper for indexing prior yield events during replay

The important behavioral contract is that `append()` only completes after the event is durably persisted. Callers rely on that guarantee before resuming workflow execution.

## Main APIs

The public surface from `src/index.ts` is:

- `DurableStream`
- `InMemoryStream`
- `ReplayIndex`
- `YieldEntry`

## Example

```ts
import { InMemoryStream } from "@tisyn/durable-streams";
import { execute } from "@tisyn/runtime";

const stream = new InMemoryStream();

const first = yield* execute({ ir, stream });
const second = yield* execute({ ir, stream });
```

`InMemoryStream` is useful for tests and fixtures. Real applications can implement `DurableStream` against a file, database, log, or other persistent backend.

## Replay Indexing

`ReplayIndex` exists to answer the runtime's replay questions efficiently:

- which effect ID was yielded at a given point
- what prior result should be reused
- whether execution has already closed

That logic is separate from physical storage so backends stay simple.

## Relationship to the Rest of Tisyn

- [`@tisyn/kernel`](../kernel/README.md) defines `DurableEvent`, `YieldEvent`, and `CloseEvent`.
- [`@tisyn/runtime`](../runtime/README.md) reads from and writes to the stream during execution.
- [`@tisyn/conformance`](../conformance/README.md) uses in-memory streams to verify replay behavior.

## Boundaries

This package does not evaluate IR or dispatch effects. It owns:

- the event-stream contract
- the in-memory implementation
- replay indexing helpers

It does not own execution semantics or persistence policy beyond the append/read interface.
