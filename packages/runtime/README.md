# `@tisyn/runtime`

`@tisyn/runtime` is the durable execution layer for Tisyn IR.

It takes validated IR, replays previously recorded execution from a durable event stream, dispatches live effects through installed agents, and appends new events as execution continues. In practice, this is the package that turns a Tisyn program from static IR into running work.

## Where It Fits

`@tisyn/runtime` sits at the center of execution:

- `@tisyn/compiler` turns authored source into Tisyn IR.
- `@tisyn/validate` checks that incoming IR is well-formed and safe to execute.
- `@tisyn/kernel` defines evaluation behavior and event semantics.
- `@tisyn/durable-streams` provides the durable event log used for replay and continuation.
- `@tisyn/agent` provides the installed effect handlers used for live dispatch.
- `@tisyn/transport` provides scope-local remote transport installation used during scope orchestration.

If you want to **run** a Tisyn program rather than compile, inspect, or validate it, this is the package you use.

## What This Package Does

`@tisyn/runtime` is responsible for:

- validating executable input
- loading and replaying prior execution events
- reconstructing runtime state from the durable stream
- continuing evaluation from the correct point
- dispatching live effects through installed agents
- orchestrating compound external nodes such as `scope`, `all`, `race`, `spawn`, `join`, `resource`, and `provide`, including scope-local transport and middleware lifecycle
- appending new yield and close events before resuming execution
- exposing local and remote execution entrypoints

This package is where durability becomes operational.

## Core Concepts

### Durable execution

Execution does not begin from scratch every time. The runtime first consults the durable stream, reuses any previously recorded results, and only performs live work when needed.

### Replay

Prior events are read from the stream and used to rebuild execution state. This allows the runtime to continue from known results instead of re-running completed work.

### Dispatch

When evaluation reaches a live effect that is not already satisfied by replay, the runtime routes that effect through the installed agents.

### Structured concurrency

The runtime also supervises child tasks created by `spawn` and resumed by `join`. Child work remains tied to its parent execution boundary rather than escaping into detached background activity.

### Resource lifecycle

The runtime orchestrates `resource` and `provide` compound externals. A resource child runs an init phase to compute and `provide` a value to the parent, then waits for the parent to exit before running cleanup (finally) effects. Children spawned during init are torn down before cleanup begins (R22). Multiple resources tear down in reverse creation order (R21), and child Close events precede parent Close events (R23).

### Remote execution

The runtime can also execute IR that has already been received from another process, host, or transport boundary.

## Main APIs

The public surface exported from `src/index.ts` is:

- `execute` — Run IR durably against a stream, replay prior events, and dispatch live effects.
- `ExecuteOptions` — Configuration accepted by `execute()`, including IR, environment, and stream inputs.
- `ExecuteResult` — Structured result returned by `execute()`.
- `executeRemote` — Execute received IR in a remote-execution context.
- `ExecuteRemoteOptions` — Configuration accepted by `executeRemote()`.

## `execute()`

`execute()` is the main durable execution entrypoint.

```ts
import { Add, Q } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";

const ir = Add(Q(20), Q(22));
const { result } = yield* execute({ ir });
```

At a high level, `execute()` performs the following steps:

1. validate the incoming IR
2. load prior events from the durable stream
3. rebuild replay state from those events
4. continue evaluation from the recovered state
5. dispatch live effects through installed agents as needed
6. append new yield and close events before resuming

Use `execute()` when you want full durable behavior: replay, continuation, and effect dispatch backed by a stream.

## `executeRemote()`

`executeRemote()` is the entrypoint for running IR that has already crossed a boundary.

```ts
import { executeRemote } from "@tisyn/runtime";

const result = yield* executeRemote({
  program: receivedIr,
  env: { customerId: "123" },
});
```

Use `executeRemote()` when a host, protocol layer, session manager, or transport has already received a program and wants the runtime to execute it under a supplied environment.

This is especially useful when execution is being delegated or resumed outside the original authoring context.

## Typical Execution Flow

A typical durable execution cycle looks like this:

1. receive or construct IR
2. validate it
3. open or attach to the durable stream
4. replay prior events
5. resume evaluation
6. dispatch any unsatisfied live effects
7. append new execution events
8. return the latest structured result

The runtime only performs live work where replay can no longer satisfy evaluation.

## Relationship to the Rest of Tisyn

- [`@tisyn/compiler`](../compiler/README.md) produces executable IR from authored source.
- [`@tisyn/validate`](../validate/README.md) checks executable boundaries before runtime evaluation begins.
- [`@tisyn/kernel`](../kernel/README.md) defines how IR evaluates and what events mean.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the append-only event log used for replay and continuation.
- [`@tisyn/agent`](../agent/README.md) provides the installed handlers used for live effect dispatch.

## Boundaries

`@tisyn/runtime` owns:

- durable execution
- replay from prior events
- reconstruction of execution state from the stream
- live effect dispatch through installed agents
- remote execution entrypoints

`@tisyn/runtime` does **not** own:

- authored workflow compilation
- low-level IR definitions
- kernel semantics themselves
- transport protocols or session management
- durable stream implementation details

## When to Use This Package

Use `@tisyn/runtime` when you need to:

- run Tisyn IR durably
- continue execution from a prior event stream
- dispatch effects through installed agents
- execute received IR inside a controlled runtime boundary

If you only need to compile, inspect, validate, or transport programs, another package is likely the better entrypoint.

## Summary

`@tisyn/runtime` is the package that makes Tisyn programs run.

It connects validated IR, kernel semantics, durable streams, and installed agents into a single execution path that can replay prior work, continue safely, and dispatch new effects as execution unfolds.
