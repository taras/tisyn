# `useConfig(ConfigToken)` + Config Context Handoff

Base:
- repo: `/Users/tarasmankovski/Repositories/cowboyd/tisyn`
- worktree: `/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/tisyn-use-config`
- branch: `feat/tisyn-use-config`
- base commit: `5d4c6b1` (`Merge pull request #70 from taras/feat/tisyn-cli-mvp`)

## Summary

PR 70 already landed most of the machinery for config-aware execution:

- the compiler recognizes authored `useConfig`
- the runtime journals `__config` for replay safety
- the CLI resolves projected config before execution

But two parts of the landed shape needed refinement:

1. no-arg `yield* useConfig()` is too weakly typed
2. bare `useConfig()` should be namespaced as `Config.useConfig(Token)`

This branch moved to the intended design:

```ts
const config = yield* Config.useConfig(AppConfigToken);
```

- `Config.useConfig(Token)` is the public authored read API
- `execute({ ir, env, stream, config })` is the public runtime bootstrap API for resolved config
- runtime uses an internal config context behind `execute()` — workflow code reads it via `Config.useConfig(Token)`
- `__config` remains the journaled durability boundary

## Branch-Level Decision

Adopted:

```ts
yield* Config.useConfig(AppConfigToken)
```

backed by:

- `ConfigToken<T>` for static typing (compile-time only, erased)
- `ExecuteOptions.config` as the runtime bootstrap API for resolved config
- an internal Effection context behind `execute()` for scope propagation
- the existing journaled `__config` effect as the durable/replay boundary

## Model

### Authored API

```ts
const config = yield* Config.useConfig(AppConfigToken);
```

- the token carries compile-time type information
- the token is erased by the compiler
- the compiler lowers this to `ExternalEval("__config", Q(null))`

### Runtime API

- resolved config is supplied via `ExecuteOptions.config`
- `execute()` internally seeds an Effection context from that field
- `__config` effect dispatch reads from the context
- the yielded result is journaled, so replay remains safe

### Startup ownership

- CLI/startup resolves the descriptor projection
- CLI passes the projection as `config` to `execute()`
- `execute()` handles internal context propagation
- workflow code reads it via `Config.useConfig(Token)`

## Recommended Shape

### 1. Typed token in `@tisyn/config`

Add:

```ts
export interface ConfigToken<T> {
  readonly __tisyn_config_token__: unique symbol;
}

export function configToken<T>(): ConfigToken<T>;
```

### 2. Workflow-facing helper in `@tisyn/config`

Add:

```ts
export function* useConfig<T>(_token: ConfigToken<T>): Generator<unknown, T, unknown> {
  throw new Error("useConfig() must be compiled by the Tisyn compiler.");
}
```

This exists for TypeScript typing only. The compiler erases it.

### 3. Runtime config context

Add a runtime-owned context, analogous to bound-agent context:

```ts
export const ConfigContext = createContext<Record<string, unknown> | null>("$config", null);
```

Then:

- startup code sets it before execution
- runtime `__config` handling reads from it

### 4. Runtime bootstrap

`execute({ config })` is the public runtime API for supplying resolved config. Internally, `execute()` seeds an Effection context that `__config` dispatch reads from.

## What Already Exists

Already landed on `main`:

- compiler lowering/tests
  - `packages/compiler/src/emit.ts`
  - `packages/compiler/src/use-config.test.ts`
- runtime execution/replay/tests
  - `packages/runtime/src/execute.ts`
  - `packages/runtime/src/use-config.test.ts`
- CLI config-aware execution
  - `packages/cli/src/run.ts`
  - `packages/cli/README.md`

Current docs reflect the now-intermediate API and must be updated.

## Concrete Work

### 1. Add typed token support in `@tisyn/config`

Likely files:

- `packages/config/src/types.ts`
- `packages/config/src/constructors.ts`
- `packages/config/src/use-config.ts`
- `packages/config/src/index.ts`
- `packages/config/README.md`

Required outcome:

- `ConfigToken<T>` is public
- `configToken<T>()` is public
- `useConfig<T>(token)` is public and typed

### 2. Change compiler recognition from no-arg to token-arg form

Likely file:

- `packages/compiler/src/emit.ts`

Required behavior:

- `yield* useConfig(Token)` compiles
- it still lowers to `ExternalEval("__config", Q(null))`
- token is compile-time only

Reject:

- `yield* useConfig()`
- `yield* useConfig(a, b)`
- optionally non-identifier token forms if you keep the first pass narrow

### 3. Update compiler error codes

Revise the old no-arg error surface to match the new API, for example:

- `UC1`: `useConfig() requires exactly one ConfigToken argument`
- `UC2`: `useConfig() argument must be a ConfigToken identifier`

Update specs/docs/tables accordingly.

### 4. Add runtime config context

Likely files:

- `packages/runtime/src/execute.ts`
- possibly a small new runtime helper/context file if that reads better

Required behavior:

- resolved config is supplied via `ExecuteOptions.config`
- `execute()` internally seeds an Effection context from that field
- `__config` effect dispatch reads from the internal context
- replay behavior stays unchanged because the effect result is journaled

### 5. CLI passes config through execute()

Likely files:

- `packages/cli/src/run.ts`

Required behavior:

- CLI resolves projected config
- CLI passes it as `config` to `execute()`
- workflow code reads it via `yield* Config.useConfig(Token)`

### 6. Add type-level verification

Add config-package tests that prove:

```ts
const cfg = yield* useConfig(AppToken);
```

is statically typed as the token’s `T`.

This should include:

- valid property access that type-checks
- invalid property access rejected with `@ts-expect-error`

### 7. Add authored integration coverage

Located in:

- `packages/runtime/src/use-config-integration.test.ts`

Cover at least:

1. post-overlay config is visible to workflow code
2. post-resolution config is visible to workflow code
3. invocation args remain separate from config
4. wrong-arity authored form fails at compile time

### 8. Update canonical specs and docs

Must update:

- `specs/tisyn-config-specification.md`
- `specs/tisyn-config-test-plan.md`
- `specs/tisyn-compiler-specification-1.1.0.md`
- `specs/tisyn-authoring-layer-spec.md`

Also verify:

- `specs/tisyn-cli-specification.md`
- `specs/tisyn-cli-test-plan.md`
- `packages/compiler/README.md`
- `packages/runtime/README.md`
- `packages/cli/README.md`
- `packages/config/README.md`

### 9. Scope the spec carefully

Document this clearly:

- `Config.useConfig(Token)` is the authored API
- the token supplies static typing and is erased by the compiler
- `execute({ config })` is the runtime bootstrap API
- runtime uses an internal context behind `execute()` for scope propagation
- `__config` remains the durable/replay boundary
- descriptor-shape-to-type inference is still not automatic

## Scope

### In scope

- changing `useConfig` from no-arg to token-arg public API
- adding `ConfigToken<T>` / `configToken<T>()`
- adding a runtime config context as the true config source
- compiler/runtime/CLI/docs/test alignment for that API

### Out of scope

- automatic inference of exact config type from descriptor constructors
- runtime validation that a token matches the currently executing descriptor
- broader redesign of config projection shape
- a new standalone config typing system

## Expected Outcome

After this branch:

- workflows consume config through a typed, namespaced API:
  - `yield* Config.useConfig(AppConfigToken)`
- resolved config is supplied via `ExecuteOptions.config`
- runtime internally propagates config through an Effection context
- `__config` remains replay-safe and journaled
- specs/docs reflect the final design

## Verification

Run at least:

- `pnpm --filter @tisyn/config test`
- `pnpm --filter @tisyn/compiler test`
- `pnpm --filter @tisyn/runtime test`
- `pnpm --filter @tisyn/cli test`
- `pnpm run lint`
- `pnpm build`

This is no longer a docs-only pass. The public API and runtime ownership model are changing together.
