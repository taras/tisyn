# `@tisyn/runtime`

Durable execution for Tisyn IR, plus remote execution of received IR programs.

Use this package when you want to execute Tisyn programs with journaling, replay, and dispatch through installed agents.

## Main exports

- `execute()`
- `executeRemote()`

## Execute IR durably

```ts
import { Add, Q } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";

const ir = Add({ left: Q(20), right: Q(22) });
const { result, journal } = yield* execute({ ir });
```

`execute()` validates the IR, reads the durable stream, replays prior events, dispatches live effects, and appends yield/close events.

## Execute remote IR

```ts
import { executeRemote } from "@tisyn/runtime";

const result =
  yield*
  executeRemote({
    program: receivedIr,
    env: { customerId: "123" },
  });
```

## Relationship to the rest of Tisyn

- [`@tisyn/kernel`](../kernel/README.md) provides the core evaluation engine and durable event types.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the append-only event stream and replay index.
- [`@tisyn/agent`](../agent/README.md) provides the dispatchable effect handlers that runtime can call.
