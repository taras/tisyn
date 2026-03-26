# `@tisyn/runtime`

`@tisyn/runtime` is the package that executes Tisyn IR durably. It validates input, replays prior events from a durable stream, dispatches live effects through installed agents, and appends new yield and close events as execution progresses.

## Where It Fits

This is the main execution layer of the system.

- `@tisyn/compiler` produces IR.
- `@tisyn/validate` checks it.
- `@tisyn/kernel` defines the evaluation and event semantics.
- `@tisyn/durable-streams` stores the resulting event log.
- `@tisyn/agent` supplies the installed effect handlers.

If you want to run Tisyn programs rather than just inspect or validate them, this is the package you use.

## Core Concepts

- `execute()`: durable execution entrypoint
- replay: reuse prior events from a stream
- dispatch: route live effects to installed agents
- `executeRemote()`: execute received IR in a remote-execution context

## Main APIs

The public surface from `src/index.ts` is:

- `execute`: Run IR durably against a stream, replay prior events, and dispatch live effects.
- `ExecuteOptions`: Describe the inputs accepted by `execute()`, including IR, environment, and stream configuration.
- `ExecuteResult`: Describe the structured outcome returned by `execute()`.
- `executeRemote`: Execute received IR in a remote-execution context with supplied environment values.
- `ExecuteRemoteOptions`: Describe the inputs accepted by `executeRemote()`.

## Execute IR Durably

```ts
import { Add, Q } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";

const ir = Add(Q(20), Q(22));
const { result } = yield* execute({ ir });
```

`execute()` is the durable path:

1. validate the incoming IR
2. read prior events from the durable stream
3. rebuild replay state
4. continue evaluation
5. dispatch live effects as needed
6. append yield and close events before resuming

## Execute Received IR

```ts
import { executeRemote } from "@tisyn/runtime";

const result = yield* executeRemote({
  program: receivedIr,
  env: { customerId: "123" },
});
```

`executeRemote()` is useful when a host, transport, or protocol server has already received a program and wants the runtime to execute it under a supplied environment.

## Relationship to the Rest of Tisyn

- [`@tisyn/kernel`](../kernel/README.md) provides evaluation and event semantics.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the append-only event stream and replay index.
- [`@tisyn/agent`](../agent/README.md) provides the installed handlers for effect dispatch.
- [`@tisyn/validate`](../validate/README.md) provides the boundary checks performed before execution.

## Boundaries

`@tisyn/runtime` owns:

- durable execution
- replay
- effect dispatch during execution
- remote-execution entrypoints

It does not own:

- authored workflow compilation
- low-level IR definitions
- transport sessions or wire protocol
