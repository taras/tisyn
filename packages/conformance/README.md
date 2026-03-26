# `@tisyn/conformance`

`@tisyn/conformance` is the fixture harness for verifying that a Tisyn runtime behaves the way the specs say it should. It is not an application testing package; it is a package for testing runtimes, replay behavior, dispatch behavior, and negative cases against known fixtures.

## Where It Fits

This package sits above the runtime and below product-level tests.

- `@tisyn/runtime` is the system under test.
- `@tisyn/durable-streams` supplies the replayable event stream used by fixtures.
- `@tisyn/agent` supplies installed handlers for effect fixtures.

Use it when you are implementing or adapting Tisyn execution behavior and want to prove that behavior against stable examples.

## Core Concepts

- `Fixture`: the input definition for a conformance case
- `runFixture()`: executes the fixture and captures the result
- `FixtureResult`: the structured outcome used by tests

Fixtures can cover:

- successful evaluation
- replay behavior
- effect dispatch
- validation failures
- runtime failures

## Main APIs

The public surface from `src/index.ts` is:

- `runFixture`
- `Fixture`
- `FixtureResult`

## Example

```ts
import { runFixture } from "@tisyn/conformance";

const result = await runFixture(fixture);

if (result.status !== "passed") {
  throw new Error(result.message);
}
```

## Relationship to the Rest of Tisyn

- [`@tisyn/runtime`](../runtime/README.md) is the thing being verified.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the event stream used during replay-oriented cases.
- [`@tisyn/agent`](../agent/README.md) provides the effect layer that fixtures can install and exercise.

## Boundaries

`@tisyn/conformance` is not:

- a general-purpose app testing toolkit
- a transport-specific browser or protocol harness
- the runtime itself

It is the package for asserting that Tisyn execution semantics remain consistent.
