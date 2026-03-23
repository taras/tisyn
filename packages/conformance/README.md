# `@tisyn/conformance`

Fixture harness for verifying Tisyn runtime behavior against expected results and journals.

Use this package when you want to run conformance fixtures in tests or build higher-level spec validation around the runtime.

## Main exports

- `runFixture()`
- `Fixture`
- `FixtureResult`

## Example

```ts
import { runFixture } from "@tisyn/conformance";

const result = await runFixture(fixture);
```

Fixtures cover evaluation, effects, replay, negative validation, and negative runtime behavior.

## Relationship to the rest of Tisyn

- [`@tisyn/runtime`](../runtime/README.md) is the system under test.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the in-memory replay store used by the harness.
- [`@tisyn/agent`](../agent/README.md) provides mock dispatch middleware for effect fixtures.
