# `@tisyn/durable-streams`

`@tisyn/durable-streams` provides the append-only event stream abstraction that underpins durable execution in Tisyn. It defines how execution events are persisted, read back, and indexed for replay so workflows can resume deterministically after interruption.

## Purpose

Tisyn’s durable execution model depends on one simple guarantee: once execution emits an event, that event must be durably recorded before the system continues. This package defines the storage boundary for that guarantee.

It does not execute workflows or interpret IR. Instead, it provides the persistence contract and replay helpers that let the runtime recover execution from prior events.

## Where It Fits

`@tisyn/durable-streams` sits beneath runtime-level durable execution.

- `@tisyn/kernel` defines the durable event types
- `@tisyn/runtime` appends and replays those events during execution
- `@tisyn/durable-streams` defines the storage interface and replay indexing utilities

If `@tisyn/runtime` is responsible for durable execution, `@tisyn/durable-streams` is responsible for durable persistence and replay lookup.

## Core Concepts

### `DurableStream`

`DurableStream` is the append-only storage interface for execution events. Backends implement this contract to support durable persistence in files, databases, logs, or other storage systems.

The key behavioral requirement is:

- `append()` must not complete until the event has been durably persisted

Execution relies on that guarantee before resuming workflow progress.

### `InMemoryStream`

`InMemoryStream` is a simple in-memory implementation of `DurableStream`. It is intended for tests, fixtures, and development scenarios where real persistence is unnecessary.

### `ReplayIndex`

`ReplayIndex` builds an index over prior yield events so replay can efficiently answer questions such as:

- which effect was yielded at a given replay position
- which prior result should be reused
- whether execution has already closed

This keeps replay lookup logic separate from physical storage so storage backends can stay simple.

### `YieldEntry`

`YieldEntry` represents one indexed replay entry derived from a prior yield event.

## Public API

The public surface exported from `src/index.ts` includes:

- `DurableStream` — append/read contract for durable event storage backends
- `InMemoryStream` — in-memory `DurableStream` implementation for tests and fixtures
- `ReplayIndex` — replay helper for indexing previously recorded yield events
- `YieldEntry` — one indexed replay entry derived from a yield event

## Example

```ts
import { InMemoryStream } from "@tisyn/durable-streams";
import { execute } from "@tisyn/runtime";

const stream = new InMemoryStream();

const first = yield* execute({ ir, stream });
const second = yield* execute({ ir, stream });
```

In this example, both executions use the same stream. The first run records events into the stream, and the second run can replay from those previously persisted events.

`InMemoryStream` is useful for tests and fixtures. Production systems can implement `DurableStream` using a persistent backend such as a file, database, or append-only log.

## Replay and Persistence Model

This package exists to support deterministic continuation.

The runtime records yield and close events into a `DurableStream`. On replay, those events are read back and indexed so execution can determine what has already happened and what results should be reused.

By separating storage from replay indexing:

- storage backends remain minimal
- replay logic stays explicit and testable
- durable execution does not depend on any single persistence mechanism

## Relationship to the Rest of Tisyn

- [`@tisyn/kernel`](../kernel/README.md) defines durable event shapes such as `DurableEvent`, `YieldEvent`, and `CloseEvent`
- [`@tisyn/runtime`](../runtime/README.md) writes to and reads from the stream during execution
- [`@tisyn/conformance`](../conformance/README.md) uses in-memory streams to verify replay behavior

## Boundaries

This package owns:

- the append-only event stream contract
- the in-memory stream implementation
- replay indexing helpers

This package does not own:

- IR evaluation
- effect dispatch
- execution semantics
- backend-specific persistence policy beyond the append/read contract

## Summary

`@tisyn/durable-streams` is the persistence layer beneath durable Tisyn execution. It defines how execution events are durably recorded and how prior events are indexed for deterministic replay.
