# `@tisyn/validate`

`@tisyn/validate` is the boundary-defense package for Tisyn IR. It checks that incoming trees match the allowed grammar, exposes schema values for integration points, and throws `MalformedIR` when invalid input crosses a trust boundary.

## Where It Fits

This package sits between untrusted IR and execution.

- `@tisyn/compiler` validates generated IR by default.
- `@tisyn/runtime` validates incoming IR before execution.
- `@tisyn/kernel` re-exports `MalformedIR`, but validation now lives here.

Use it whenever IR comes from another process, persistent storage, user input, or an external compiler step.

## Core Concepts

- `validateGrammar()`: grammar-level checks
- `validateIr()`: full validation entrypoint
- `assertValidIr()`: throws on failure
- `MalformedIR`: error type for invalid IR
- exported schema values for integration points

## Main APIs

The public surface from `src/index.ts` is:

- `validateGrammar`
- `validateIr`
- `assertValidIr`
- `MalformedIR`
- `tisynExprSchema`
- `evalSchema`
- `quoteSchema`
- `refSchema`
- `fnSchema`

Useful exported types:

- `ValidationError`
- `ValidationResult`

## Example

```ts
import { assertValidIr } from "@tisyn/validate";

assertValidIr(maybeExternalIr);
```

If validation fails, `assertValidIr()` throws `MalformedIR`.

## Relationship to the Rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the node shapes being validated.
- [`@tisyn/compiler`](../compiler/README.md) uses validation to catch bad compiled output.
- [`@tisyn/runtime`](../runtime/README.md) uses validation before execution.
- [`@tisyn/kernel`](../kernel/README.md) depends on valid input but does not own this validation layer.

## Boundaries

`@tisyn/validate` owns:

- grammar and IR boundary checks
- malformed-IR error reporting
- exported schema values for external integrations

It does not own execution semantics or durable replay.
