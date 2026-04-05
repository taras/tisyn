# `@tisyn/cli`

`@tisyn/cli` is the command-line interface for the Tisyn workflow system. It compiles authored workflows into IR, validates descriptors, and executes workflows with full transport, journal, and server lifecycle management.

This package is the primary user-facing entry point for building and running Tisyn programs from the terminal.

## Where It Fits

`@tisyn/cli` sits at the top of the Tisyn stack, orchestrating build and execution workflows.

- `@tisyn/compiler` compiles authored workflow source into IR and generated modules.
- `@tisyn/config` defines the descriptor data model that `tsn run` and `tsn check` load.
- `@tisyn/runtime` executes compiled IR with replay, dispatch, and config resolution.
- `@tisyn/transport` provides the concrete transport factories installed during execution.

The CLI loads descriptors, resolves environment, installs transports, and hands execution off to the runtime.

## Core Concepts

### Two-phase parsing

`tsn run` uses a two-phase parsing model. Phase 1 parses built-in command options (`module`, `--entrypoint`, `--verbose`) via the CLI parsing library. Unrecognized flags remain in the remainder. Phase 2 loads the descriptor, resolves the workflow's input schema, and parses the remainder against derived workflow flags.

### Descriptor loading

A descriptor module's default export must be a `WorkflowDescriptor` (tagged with `tisyn_config: "workflow"`). The CLI resolves the workflow module path and export name from the descriptor's `run` field.

`tsn run` and `tsn check` accept descriptor modules with these extensions:

- TypeScript-family: `.ts`, `.mts`, `.cts`
- JavaScript-family: `.js`, `.mjs`, `.cjs`

`.tsx` is not supported.

Descriptor and transport-binding module loading delegates to `@tisyn/runtime`'s shared `loadModule()`:

- TypeScript-family files load through `tsx`'s `tsImport()` API
- JavaScript-family files load through native `import()`

Workflow target resolution stays separate from descriptor-module loading:

- if `run.module` explicitly points to a TypeScript-family workflow source file, the CLI compiles that source at runtime using `@tisyn/compiler`
- if `run.module` explicitly points to a JavaScript-family file, the CLI loads the pre-compiled module and extracts the named export
- if `run.module` is omitted, the CLI resolves the named export from the same module that produced the descriptor, including when that descriptor module is TypeScript

Bare `Fn` IR nodes (produced by the compiler) are automatically invoked: zero-parameter workflows are called directly, and single flat-object-parameter workflows receive parsed CLI flags as their argument. Destructured function parameters are not supported — use `(input: { ... })` form.

### Invocation inputs

Workflow input parameters are derived from compiler-emitted `inputSchemas` metadata. Field names are converted from camelCase to kebab-case CLI flags. Supported field types: `string`, `number`, `boolean`.

### Resolved config

After overlay application and environment resolution, the CLI passes the projected configuration into runtime execution through `ExecuteOptions.config`. Workflows access it via `yield* Config.useConfig(Token)`, where `Token` is a `ConfigToken<T>` that provides static typing. The runtime config context is an internal execution mechanism behind that public bootstrap path.

### Local and inprocess transport modules

Modules referenced by `transport.local()` or `transport.inprocess()` can export either:

- `createBinding(config?)` returning a `LocalAgentBinding` with a transport factory and optional `bindServer` hook (preferred). If the agent descriptor includes a `config` bag, the resolved config (with env nodes replaced by their values) is passed as the first argument.
- `createTransport()` returning a plain `AgentTransportFactory` (backward-compatible)

Both types are exported from `@tisyn/transport`.

These transport binding modules use the same bootstrap loader as descriptor modules, so `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs` are supported here as well. `.tsx` is not supported.

When a server is configured, the CLI starts the server first and calls `bindServer(serverBinding)` on bindings that support it. The `LocalServerBinding` provides the server address and accepted WebSocket connections as a typed `Stream<Operation<WebSocket>, never>`, letting modules receive browser connections without accessing raw `WebSocketServer` internals.

`bindServer` is a setup-only hook: it spawns any long-lived work (connection loops) and returns promptly so startup can proceed to transport installation and workflow execution.

## Installation

```bash
pnpm add @tisyn/cli
```

## Commands

### `tsn generate`

Compile one workflow source file into a generated TypeScript module.

```bash
tsn generate workflow.ts -o workflow.generated.ts
```

### `tsn build`

Run config-driven multi-pass generation from a `tisyn.config.ts` file.

```bash
tsn build
tsn build -c path/to/tisyn.config.ts
```

### `tsn run`

Load a workflow descriptor module, validate readiness, and execute the workflow.

```bash
tsn run ./descriptor.ts
tsn run ./workflow.ts -e dev
tsn run ./descriptor.ts -e dev --max-turns 10
```

The `run` command:
1. Loads and validates the workflow descriptor (default export)
2. Applies an entrypoint overlay if `--entrypoint` is specified
3. Resolves the workflow target:
   - explicit TypeScript-family workflow source -> compiler path
   - explicit JavaScript-family workflow module -> bootstrap module loading
   - omitted `run.module` -> same-module export lookup
4. Parses CLI flags against the workflow's input schema metadata
5. Resolves environment variables from the process environment
6. Installs agent transports, starts servers, creates journal streams
7. Executes the workflow through `@tisyn/runtime`

### `tsn check`

Validate descriptor readiness without executing. Runs the same loading and validation as `run` but stops before starting transports or executing.

```bash
tsn check ./descriptor.ts
tsn check ./descriptor.ts -e staging
tsn check ./descriptor.ts --env-example
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Compilation error |
| 2 | Structural/validation error (invalid descriptor, bad export) |
| 3 | I/O error (module not found, import failure) |
| 4 | Input error (unknown flag, missing required, coercion failure) |
| 5 | Environment error (missing required/secret env variable) |
| 6 | Runtime execution error |

## Relationship to the Rest of Tisyn

- [`@tisyn/compiler`](../compiler/README.md) produces the generated modules and input schema metadata consumed by `tsn run`.
- [`@tisyn/config`](../config/README.md) defines the descriptor constructors and validation used by `tsn run` and `tsn check`.
- [`@tisyn/runtime`](../runtime/README.md) executes workflows and resolves config projections.
- [`@tisyn/transport`](../transport/README.md) provides transport factories installed during `tsn run`.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the journal stream used during execution.

## Boundaries

`@tisyn/cli` owns:

- CLI argument parsing and command dispatch
- descriptor loading and validation
- bootstrap module loading for descriptor and transport-binding modules
- two-phase input flag derivation and parsing
- transport, server, and journal lifecycle orchestration
- dynamic and static help generation

`@tisyn/cli` does not own:

- workflow compilation (owned by `@tisyn/compiler`)
- config resolution semantics (owned by `@tisyn/runtime`)
- IR evaluation or replay (owned by `@tisyn/runtime` and `@tisyn/kernel`)
- transport protocols or agent dispatch (owned by `@tisyn/transport` and `@tisyn/agent`)

## Summary

`@tisyn/cli` is the command-line entry point for building and running Tisyn workflows. It loads descriptors, derives input flags from compiled metadata, orchestrates runtime resources, and hands execution off to `@tisyn/runtime`.
