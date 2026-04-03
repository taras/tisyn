# @tisyn/cli

Command-line interface for the Tisyn workflow system.

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
tsn run ./descriptor.ts -e dev --max-turns 10
```

The `run` command:
1. Loads and validates the workflow descriptor (default export)
2. Applies an entrypoint overlay if `--entrypoint` is specified
3. Resolves the compiled workflow IR from the generated module
4. Parses CLI flags against the workflow's input schema metadata
5. Resolves environment variables from the process environment
6. Installs agent transports, starts servers, creates journal streams
7. Executes the workflow through `@tisyn/runtime`

**Invocation inputs** are derived from compiler-emitted `inputSchemas` metadata.
Field names are converted from camelCase to kebab-case CLI flags. Supported field
types: `string`, `number`, `boolean`.

**Resolved config** is the projected configuration after overlay application and
environment resolution. Workflows access it via `yield* useConfig()`.

### `tsn check`

Validate descriptor readiness without executing. Runs the same loading and
validation as `run` but stops before starting transports or executing.

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
