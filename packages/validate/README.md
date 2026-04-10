# `@tisyn/validate`

`@tisyn/validate` is Tisyn’s IR validation and boundary-defense package. It verifies that incoming trees conform to the allowed grammar, provides schema values for integrations, and throws `MalformedIR` when invalid IR crosses a trust boundary.

Use this package anywhere IR enters the system from a source you do not fully trust, including external processes, storage, user input, or separate compilation steps.

## Where It Fits

`@tisyn/validate` sits between untrusted IR and execution.

- `@tisyn/compiler` uses it to validate generated IR by default.
- `@tisyn/runtime` uses it to validate incoming IR before execution.
- `@tisyn/kernel` depends on valid IR and re-exports `MalformedIR`, but validation itself lives here.

In practice, this package answers one question:

**Is this IR safe to admit into the system as a valid Tisyn expression?**

## What It Does

`@tisyn/validate` is responsible for:

- validating IR against the allowed grammar
- reporting concrete validation failures
- throwing a boundary-specific error when invalid IR is admitted
- exporting schema values for external integrations and tooling
- validating `scope` eval nodes: handler type, bindings shape, and eval-position constraints
- validating `resource` eval nodes: data must be a Quote with a `body` field in evaluation position
- validating `provide` eval nodes: data is any expression (not Quote-wrapped), similar to `join`
- validating `timebox` eval nodes: `data` must be a Quote with `duration` and `body`, and the `duration` subtree may not contain external evals

It does not define execution behavior, concurrency semantics, or durable replay. Its job is to protect the boundary before those layers begin.

## Core Concepts

### Trust boundaries

Validation matters most when IR crosses a boundary between trusted and untrusted contexts. Common examples include:

- IR received from another process or service
- IR loaded from persistent storage
- IR constructed from user input
- IR produced by an external or separate compiler step

Inside those boundaries, `@tisyn/validate` makes malformed input explicit before it reaches the runtime.

### Grammar validation

The package checks that IR follows the allowed Tisyn grammar and node shapes. This includes validating the structural form of the tree rather than executing or interpreting it.

### `MalformedIR`

When invalid input crosses a trust boundary, the package represents that failure with `MalformedIR`. This makes malformed IR a first-class boundary error rather than a vague downstream failure.

## Public API

The main public surface is exported from `src/index.ts`.

### Validation functions

- `validateGrammar`  
  Check that an IR tree follows the allowed grammar rules without throwing.

- `validateIr`  
  Perform full validation and return a structured validation result.

- `assertValidIr`  
  Validate IR and throw `MalformedIR` if the input is invalid.

### Error type

- `MalformedIR`  
  Error type used when invalid IR crosses a trust boundary.

### Exported error codes

- `TIMEBOX_DURATION_EXTERNAL`  
  Validation error code raised when a `timebox` duration subtree contains an external eval. `timebox` duration may contain only structural evaluation.

### Exported schemas

- `tisynExprSchema`  
  Top-level schema for a full Tisyn expression.

- `evalSchema`  
  Schema for eval nodes.

- `quoteSchema`  
  Schema for quote nodes.

- `refSchema`  
  Schema for ref nodes.

- `fnSchema`  
  Schema for function-shaped IR nodes.

### Useful types

- `ValidationError`  
  Describes one concrete validation problem found in the IR.

- `ValidationResult`  
  Represents the success or failure result returned by validation functions.

## Parsing Unknown Input

Use the exported TypeBox schemas when you need to validate already-parsed JavaScript values before treating them as IR.

`tisynExprSchema` covers a full `IrInput`-style expression tree. `fnSchema` is narrower: it validates function-shaped IR nodes only.

```ts
import { Value } from "@sinclair/typebox/value";
import { fnSchema } from "@tisyn/validate";
import type { TisynFn } from "@tisyn/ir";

function parseFnInput(input: unknown): TisynFn<unknown[], unknown> {
  if (!Value.Check(fnSchema, input)) {
    const detail = [...Value.Errors(fnSchema, input)]
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid fn node: ${detail}`);
  }

  return input as TisynFn<unknown[], unknown>;
}
```

If you need to accept any full IR expression rather than only `fn` nodes, validate against `tisynExprSchema` instead.

## Validation Rules Worth Knowing

Most callers can treat validation as a black box, but a few package-level rules are worth knowing when constructing IR directly:

- `scope` validates handler shape, bindings shape, and eval-position constraints
- `resource` requires Quote-wrapped `{ body }` data
- `provide` accepts any expression payload directly
- `timebox` requires Quote-wrapped `{ duration, body }` data, and `duration` must stay structural-only

## Example

```ts
import { assertValidIr } from "@tisyn/validate";

assertValidIr(maybeExternalIr);
```

If validation fails, `assertValidIr()` throws `MalformedIR`.

## When to Use It

Use `@tisyn/validate` whenever IR enters the system from a source that may be malformed, outdated, corrupted, or untrusted.

Typical uses include:

- validating IR before runtime execution
- validating compiler output in tests or integration pipelines
- protecting transport boundaries between services or agents
- checking persisted IR before loading or replaying it
- exposing schema definitions to external tools and adapters
- checking hand-built `timebox` IR before execution, especially when the duration comes from generated expression trees

## Relationship to the Rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the IR node shapes that this package validates.
- [`@tisyn/compiler`](../compiler/README.md) uses validation to catch invalid compiled output.
- [`@tisyn/runtime`](../runtime/README.md) validates incoming IR before execution.
- [`@tisyn/kernel`](../kernel/README.md) assumes valid input but does not own validation.

## Boundaries and Responsibilities

`@tisyn/validate` owns:

- grammar and structural IR validation
- malformed-IR boundary errors
- exported schema values for integrations

`@tisyn/validate` does not own:

- execution semantics
- runtime evaluation
- structured concurrency behavior
- durable replay or journaling

## Summary

`@tisyn/validate` protects the boundary between untrusted IR and the rest of the Tisyn system. It ensures that only well-formed expressions move forward into execution, and it gives both internal code and external integrations a clear, consistent validation surface.
