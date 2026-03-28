# Tisyn CLI Specification

**Version:** 0.1.0
**Complements:** Tisyn Compiler Specification 1.1.0
**Status:** Draft

---

## 1. Overview

This document specifies `tsn`, the Tisyn command-line interface for
compiling authored workflow source into generated TypeScript modules.

The CLI is a thin orchestration layer over `generateWorkflowModule()`.
It owns invocation ergonomics, file I/O, diagnostics formatting,
multi-pass ordering, and cross-pass stub injection. It does NOT own
compilation logic — that belongs to `@tisyn/compiler`.

### 1.1 Package

```
@tisyn/cli
```

### 1.2 Binary

```
tsn
```

The package MUST register `tsn` as a `bin` entry in `package.json`.

### 1.3 Scope

The CLI is responsible for:

- parsing flags, environment variables, and config files into a
  validated generation plan
- reading declaration and workflow source files from disk
- calling `generateWorkflowModule()` with assembled source text
- writing generated output to files or stdout
- ordering multi-pass generation via import-graph inference
- injecting cross-pass stubs so the compiler's TypeScript parser
  accepts free variables from prior passes
- formatting diagnostics for terminal display
- process lifecycle (signal handling, exit codes)

The CLI is NOT responsible for:

- IR lowering, contract discovery, or validation (compiler)
- IR execution or replay (runtime, kernel)
- watch mode (deferred to a later version)
- plugin systems, custom transforms, or middleware
- monorepo-aware cross-workspace generation

### 1.4 Dependencies

```
@tisyn/cli
  ├── @tisyn/compiler
  ├── configliere
  └── effection
```

No package in the Tisyn workspace depends on `@tisyn/cli`.

---

## 2. Commands

### 2.1 `tsn generate`

Single-file generation. Compiles one set of source files into one
output module.

```
tsn generate <input> [options]
```

**Arguments:**

| Argument | Required | Description |
| --- | --- | --- |
| `input` | YES | Path to declaration file (`.ts`) |

**Options:**

| Flag | Alias | Env | Default | Description |
| --- | --- | --- | --- | --- |
| `--output <path>` | `-o` | `TISYN_OUTPUT` | stdout | Output file path |
| `--format <type>` | | `TISYN_FORMAT` | `printed` | Output format: `printed` or `json` |
| `--no-validate` | | `TISYN_VALIDATE=false` | validate | Skip IR validation |
| `--include <glob>` | `-i` | | | Additional workflow files to include |
| `--verbose` | | | false | Show detailed diagnostics |
| `--help` | `-h` | | | Show help |
| `--version` | `-v` | | | Show version |

**Precedence:** CLI flags > environment variables > defaults.

**Behavior:**

1. Parse and validate options.
2. Read the declaration file at `<input>`.
3. If `--include` is specified, read each matching workflow file.
4. Concatenate declaration source with workflow source texts,
   separated by blank lines.
5. Call `generateWorkflowModule()` with the concatenated source.
6. If `--output` is specified, write the generated source to the
   file. Otherwise, write to stdout.
7. Exit with code 0 on success.

**Examples:**

```bash
# Single declaration file, output to stdout
tsn generate src/workflow.ts

# Declaration + workflow files, write to file
tsn generate src/declarations.ts -i 'src/**/*.workflow.ts' -o gen/workflow.ts

# JSON format output
tsn generate src/declarations.ts --format json -o gen/workflow.ts
```

### 2.2 `tsn build`

Config-driven multi-pass generation. Reads a config file declaring
all generation passes, infers ordering from import dependencies,
and executes passes in dependency order.

```
tsn build [options]
```

**Options:**

| Flag | Alias | Env | Default | Description |
| --- | --- | --- | --- | --- |
| `--config <path>` | `-c` | `TISYN_CONFIG` | auto-discover | Config file path |
| `--filter <name>` | | | | Run only the named pass |
| `--verbose` | | | false | Show detailed diagnostics |
| `--help` | `-h` | | | Show help |

**Config auto-discovery:** If `--config` is not specified, the CLI
MUST walk from the current working directory toward the filesystem
root, stopping at the first directory that contains a file named
`tisyn.config.ts` or `tisyn.config.json`. If no config file is
found, the CLI MUST exit with code 2 and a diagnostic message.

**Behavior:**

1. Locate and load the config file (§3).
2. Validate the config against the schema (§3.3).
3. Resolve all `input` and `include` paths relative to the config
   file's directory.
4. Build the pass dependency graph (§4).
5. Topological-sort passes by inferred dependencies. If a cycle
   is detected, exit with code 2 and a diagnostic identifying the
   cycle.
6. If `--filter` is specified, execute only the named pass (and
   any passes it depends on). If the name does not match a
   declared pass, exit with code 2.
7. For each pass in dependency order:
   a. Read the declaration source and workflow source files.
   b. If prior passes produced output that this pass imports (§4),
      inject stubs (§4.3).
   c. Concatenate sources.
   d. Call `generateWorkflowModule()` with the concatenated source
      and the pass's `format` option.
   e. Write the generated output to the pass's `output` path.
8. Exit with code 0 on success.

---

## 3. Configuration

### 3.1 Configliere Integration

Configliere owns the CLI-flag and environment-variable surface:

- parsing all CLI flags into typed values
- reading `TISYN_*` environment variables
- merging sources with precedence: CLI flags > env vars > defaults
- validating flag/env values against their schemas
- generating help/usage text
- command dispatch

`config.ts` owns the build config file surface:

- discovering `tisyn.config.ts` / `tisyn.config.json` by walking up
  the directory tree
- transpiling and dynamically importing `tisyn.config.ts`
- structural validation of the loaded config object
- resolving all paths relative to the config file

Configliere does NOT own:

- config-file discovery or loading
- file glob resolution
- the compilation pipeline
- output file writing
- import-graph analysis
- stub injection

### 3.2 Config File Format

The config file MUST be a TypeScript module or a JSON file.

**TypeScript format** (`tisyn.config.ts`):

```typescript
import { defineConfig } from "@tisyn/cli";

export default defineConfig({
  generates: [
    {
      name: "dom-workflows",
      input: "test/browser/workflows/dom-declarations.ts",
      include: ["test/browser/workflows/dom/**/*.workflow.ts"],
      output: "test/browser/dom-workflows.generated.ts",
      format: "json",
    },
    {
      name: "host-workflows",
      input: "test/browser/workflows/host-declarations.ts",
      include: ["test/browser/workflows/*.workflow.ts"],
      output: "test/browser/host-workflows.generated.ts",
    },
  ],
});
```

**JSON format** (`tisyn.config.json`):

```json
{
  "generates": [
    {
      "name": "dom-workflows",
      "input": "test/browser/workflows/dom-declarations.ts",
      "include": ["test/browser/workflows/dom/**/*.workflow.ts"],
      "output": "test/browser/dom-workflows.generated.ts",
      "format": "json"
    }
  ]
}
```

`defineConfig()` is a passthrough identity function that exists
solely for TypeScript type inference.

### 3.3 Config Schema

```typescript
interface TsynConfig {
  generates: GeneratePass[];
}

interface GeneratePass {
  /** Unique name for this pass. Used with --filter. */
  name: string;

  /** Path to the declaration file. */
  input: string;

  /**
   * Glob patterns for additional workflow files to include.
   * Resolved relative to the config file's directory.
   */
  include?: string[];

  /** Path to the generated output file. */
  output: string;

  /**
   * Output format. Default: "printed".
   * "printed" emits constructor-form IR.
   * "json" emits JSON object literals.
   */
  format?: "printed" | "json";

  /** Skip IR validation for this pass. Default: false. */
  noValidate?: boolean;

  /**
   * Explicit ordering override. Names of passes that MUST
   * complete before this pass runs. Use only when the
   * dependency is not visible in source imports.
   */
  dependsOn?: string[];
}
```

**Validation rules:**

- `generates` MUST contain at least one entry.
- Each `name` MUST be unique within `generates`.
- Each `name` MUST match `[a-z][a-z0-9-]*`.
- Each `input` path MUST resolve to an existing file.
- Each `output` path MUST be writable (parent directory exists).
- If `dependsOn` references a name not present in `generates`,
  the CLI MUST reject the config with a diagnostic.

### 3.4 Provenance

When `--verbose` is active, the CLI SHOULD display the resolved
value and source of each configuration parameter before
compilation begins:

```
config: tisyn.config.ts (auto-discovered)
pass "dom-workflows":
  input:  test/browser/workflows/dom-declarations.ts (from config)
  output: test/browser/dom-workflows.generated.ts (from config)
  format: json (from config)
```

---

## 4. Multi-Pass Ordering

### 4.1 Import-Graph Inference

The CLI MUST infer pass dependencies from the import graph of
source files without requiring explicit `dependsOn` annotations
in the common case.

**Algorithm:**

1. For each pass `P`, collect all source files: the `input`
   declaration file and all files matching `include` globs.
2. For each source file, parse it with `ts.createSourceFile()`
   and extract all `ImportDeclaration` module specifier strings.
3. Resolve each specifier relative to the source file's directory
   using `path.resolve()`. The CLI MUST NOT perform TypeScript
   `paths` resolution, `node_modules` resolution, or any other
   non-trivial module resolution. Only relative specifiers (those
   starting with `./` or `../`) are candidates.
4. For each resolved path, check whether it matches any other
   pass's declared `output` path. If it matches, add a directed
   edge from the other pass to `P` (the other pass MUST run
   first).
5. Merge inferred edges with any explicit `dependsOn` edges.
6. Topological-sort the resulting directed graph.

**Cycle detection:** If the graph contains a cycle, the CLI MUST
exit with code 2 and a diagnostic identifying the passes involved
in the cycle.

### 4.2 `dependsOn` Escape Hatch

The `dependsOn` field provides an explicit ordering override for
cases where the dependency is not visible in imports:

- A pass produces a side-effect file read by a later pass via `fs`
- The dependency is through a re-export chain the simple resolver
  cannot follow
- The user wants to force an ordering for non-import reasons

When both inferred and explicit edges exist for the same
dependency, they are equivalent — duplicates are harmless.

### 4.3 Cross-Pass Stub Injection

When pass `B` depends on pass `A` (by importing `A`'s output),
the CLI MUST inject declaration stubs into `B`'s source so the
compiler's TypeScript parser accepts free variables exported by
`A`'s generated module.

**Stub generation algorithm:**

1. After pass `A` completes, inspect `A`'s `GenerateResult`.
2. For each key `k` in `result.workflows`, emit:
   ```typescript
   declare const ${k}: unknown;
   ```
3. For each contract `c` in `result.contracts`, emit:
   ```typescript
   declare function ${c.name}(): unknown;
   ```
4. Concatenate the stubs into the source text for pass `B`,
   between the declaration source and the workflow source files.

**Correctness requirement:** Stubs MUST be inserted AFTER the
declaration file's content and BEFORE any workflow file content,
so that the workflow files' import statements (which reference
the generated output) are satisfied by the stubs rather than
causing parse errors.

**Import stripping:** Workflow source files that import from a
prior pass's generated output path MUST have those import
declarations stripped from the concatenated source before
compilation. The stub declarations replace the imports. Other
imports (e.g., `import type` from `@tisyn/agent`) MUST be
preserved.

### 4.4 Single-Pass Shortcut

If the config file contains exactly one pass with no `dependsOn`
and no inferred dependencies, the CLI MUST skip dependency
analysis and execute the pass directly. This avoids unnecessary
overhead for the simple case.

---

## 5. Source Assembly

### 5.1 Concatenation Model

The compiler's `generateWorkflowModule()` accepts a single source
string. The CLI assembles this string from multiple files.

For both `tsn generate` and each pass in `tsn build`, the source
assembly order is:

1. Declaration file content (`input`)
2. Blank line separator
3. Cross-pass stubs (§4.3), if any
4. Blank line separator
5. Workflow file contents (from `include`), each separated by a
   blank line

### 5.2 Filename

The CLI MUST pass a `filename` option to `generateWorkflowModule()`
derived from the output path (if specified) or the input path (for
stdout output). This filename appears in error messages.

### 5.3 Deduplication

If the declaration file also matches an `include` glob, the CLI
MUST NOT include it twice. The CLI MUST deduplicate by resolved
absolute path.

---

## 6. Diagnostics

### 6.1 Error Formatting

When `generateWorkflowModule()` throws a `CompileError`, the CLI
MUST format the error for terminal display:

```
error[E010]: yield* must appear in statement position only
  --> src/workflow.ts:14:5
```

The format is: `error[CODE]: message`, followed by a source
location line if the error includes line and column information.

### 6.2 Verbose Output

When `--verbose` is active, the CLI MUST display:

- Config provenance (§3.4)
- Each pass name and its resolved inputs before compilation
- The number of contracts and workflows discovered per pass
- Total elapsed time

### 6.3 Quiet Success

On success without `--verbose`, the CLI MUST produce no output
to stderr. If writing to a file, the CLI MUST print a single
confirmation line:

```
Compiled 3 workflows → gen/workflow.ts
```

If writing to stdout, the CLI MUST NOT print any non-output
content. Diagnostics go to stderr; generated source goes to
stdout.

---

## 7. Process Lifecycle

### 7.1 Effection Entrypoint

The CLI entrypoint MUST use Effection's `main()` function. This
provides:

- Structured SIGINT/SIGTERM handling
- Clean process exit without dangling handles
- A scope boundary for future async operations (watch mode,
  parallel passes)

### 7.2 Synchronous Compilation

Within the Effection `main()` scope, compilation itself is
synchronous. `generateWorkflowModule()` is a pure synchronous
function. File reads and writes use `fs` (sync or async via
Effection `call()`). The CLI MUST NOT introduce unnecessary
async boundaries around synchronous operations.

### 7.3 Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Compilation error (`CompileError`) |
| 2 | Configuration error (invalid flags, missing config, bad schema) |
| 3 | I/O error (file not found, permission denied) |

The CLI MUST exit with the appropriate code. It MUST NOT exit
with code 0 when an error occurred.

---

## 8. Relationship to Existing Compiler API

### 8.1 `generateWorkflowModule()` Is the Core

The CLI wraps `generateWorkflowModule()`. It does NOT introduce
a new compilation API beneath it, replace it, or bypass it.

### 8.2 What the CLI Adds

The CLI adds three capabilities that `generateWorkflowModule()`
does not have:

1. **File I/O.** Reading source files, resolving globs, writing
   output.
2. **Multi-pass orchestration.** Ordering passes, injecting stubs,
   threading `GenerateResult` from one pass into the next.
3. **Source assembly.** Concatenating declaration files, stubs,
   and workflow files into the single source string the compiler
   expects.

### 8.3 What Belongs in the Compiler Later

If multi-pass generation becomes a programmatic need (not just a
CLI need), the orchestration logic SHOULD be extracted into a
library function in `@tisyn/compiler` that the CLI calls. The
CLI would then become an even thinner wrapper. But this
refactoring MUST NOT happen prematurely — the CLI should prove
the orchestration model first.

---

## 9. Migration Path

### 9.1 Phase 1: `tsn generate` Replaces `build-workflow.ts`

The `multi-agent-chat` example currently uses:

```json
{
  "build:workflow": "node --experimental-strip-types src/build-workflow.ts"
}
```

After Phase 1, this becomes:

```json
{
  "build:workflow": "tsn generate src/workflow.ts -o src/workflow.generated.ts"
}
```

`build-workflow.ts` can be deleted.

### 9.2 Phase 2: `tsn build` Replaces `build-test-workflows.ts`

The `multi-agent-chat` example currently uses:

```json
{
  "build:test-workflows": "node --experimental-strip-types src/build-test-workflows.ts"
}
```

After Phase 2, a `tisyn.config.ts` is added to the example's
`test/browser/` directory:

```typescript
import { defineConfig } from "@tisyn/cli";

export default defineConfig({
  generates: [
    {
      name: "dom-workflows",
      input: "workflows/dom-declarations.ts",
      include: ["workflows/dom/**/*.workflow.ts"],
      output: "dom-workflows.generated.ts",
      format: "json",
    },
    {
      name: "host-workflows",
      input: "workflows/host-declarations.ts",
      include: ["workflows/*.workflow.ts"],
      output: "host-workflows.generated.ts",
    },
  ],
});
```

The script becomes:

```json
{
  "build:test-workflows": "tsn build -c test/browser/tisyn.config.ts"
}
```

`build-test-workflows.ts` can be deleted.

### 9.3 Phase 3: Remove Legacy Compiler Binary

The existing `bin` entry in `packages/compiler/package.json`:

```json
{
  "bin": {
    "tisyn-compile": "./dist/cli.js"
  }
}
```

MUST be removed once `tsn` is established. The `tisyn-compile`
binary has no implementation and MUST NOT coexist with `tsn`.

---

## 10. Package Structure

```
packages/cli/
  package.json
  tsconfig.json
  src/
    main.ts           ← Effection main(), command dispatch
    commands/
      generate.ts     ← tsn generate implementation
      build.ts        ← tsn build implementation
    config/
      schema.ts       ← Configliere program + field definitions
      loader.ts       ← Config file loading (TS and JSON)
      define.ts       ← defineConfig() export
    orchestrate/
      assemble.ts     ← Source concatenation logic
      deps.ts         ← Import-graph inference + topo sort
      stubs.ts        ← Cross-pass stub generation
    diagnostics/
      format.ts       ← CompileError → terminal string
    index.ts          ← Public API exports (defineConfig)
```

### 10.1 `package.json`

```json
{
  "name": "@tisyn/cli",
  "version": "0.1.0",
  "license": "UNLICENSED",
  "type": "module",
  "bin": {
    "tsn": "./dist/main.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@tisyn/compiler": "workspace:*",
    "configliere": "...",
    "effection": "4.0.2"
  },
  "devDependencies": {
    "typescript": "~5.8.0",
    "vitest": "^4"
  }
}
```

### 10.2 Public API

The `@tisyn/cli` package exports exactly one symbol for use by
config files:

```typescript
export { defineConfig } from "./config/define.js";
```

All other internals are not part of the public API.

---

## 11. Explicit Non-Goals

The following are deliberately excluded from this specification.
They are not planned for v0.1.0 and MUST NOT be implemented
without a new version of this spec.

- **Watch mode.** Requires `@effectionx/watch` integration and
  incremental rebuild semantics. Deferred until the single-shot
  model is proven.
- **Plugin system.** No third-party plugins, custom transforms,
  hook points, or middleware.
- **Incremental generation.** Every run regenerates everything.
  No caching, no change detection, no content-hash comparison.
- **IDE integration.** No LSP, no VS Code extension, no editor
  diagnostics.
- **Programmatic watch API.** Watch mode (when added) will be
  CLI-only.
- **Remote inputs.** All inputs are local files.
- **Parallel pass execution.** Passes execute sequentially in
  dependency order. Parallelism of independent passes is a future
  optimization.
- **`tsn validate`, `tsn print`, `tsn run`.** The authoring layer
  spec (§2.7) lists these commands. They are not in scope for
  this specification. They may be added in a future version.

---

## 12. Risks

### 12.1 Configliere Maturity

Configliere is a young library. If it lacks a required capability
(TypeScript config file loading, `sequence()` for phased parsing,
or Standard Schema integration with the project's preferred
schema library), the implementation MUST either contribute the
feature upstream or use Configliere's existing capabilities and
work around the gap. Replacing Configliere with another library
requires a spec revision.

### 12.2 Compiler API Stability

The CLI depends on `GenerateResult` exposing `workflows` (keyed
by name) and `contracts` (array of `DiscoveredContract`). If
these shapes change, the stub injection logic (§4.3) breaks. The
compiler MUST treat these as stable public API once the CLI ships.

### 12.3 Source Concatenation Fragility

The concatenation model (§5.1) depends on the compiler treating
concatenated source as a single file. Edge cases include:
conflicting top-level declarations across files, duplicate import
statements, and name collisions between workflow files. The CLI
SHOULD deduplicate imports where possible but MUST surface
compiler errors clearly rather than attempting heroic merges.
