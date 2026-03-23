# `@tisyn/durable-streams`

Append-only stream and replay-index primitives used by the durable runtime.

Use this package when you want to plug a storage backend into Tisyn execution or reason about replay behavior explicitly.

## Main exports

- `DurableStream`
- `InMemoryStream`
- `ReplayIndex`

## Example

```ts
import { InMemoryStream } from "@tisyn/durable-streams";
import { execute } from "@tisyn/runtime";

const stream = new InMemoryStream();
const first = yield* execute({ ir, stream });
const second = yield* execute({ ir, stream });
```

`InMemoryStream` is useful for tests. Real adapters can implement the `DurableStream` interface against durable storage.

## Relationship to the rest of Tisyn

- [`@tisyn/runtime`](../runtime/README.md) reads and appends durable events through this interface.
- [`@tisyn/kernel`](../kernel/README.md) defines the durable event shapes stored in the stream.
