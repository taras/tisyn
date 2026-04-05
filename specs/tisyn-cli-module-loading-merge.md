# CLI Specification Merge: TypeScript Descriptor Loading

This document contains the exact amendments to
`tisyn-cli-specification.md` (v0.3.4) that absorb the
module loading feature. It also includes the section
placement plan, secondary amendment assessment, and
cleanup list.

---

## A. Revised CLI Spec Text

### A1. §1.2 Scope — Add module loading to responsibilities

Replace the existing responsibility list with:

```
The CLI is responsible for:

- command dispatch, flag parsing, and help generation
- source assembly and compilation orchestration
  (`generate`, `build`)
- workflow descriptor loading, entrypoint selection, and
  environment validation (`run`, `check`)
- module loading with first-class TypeScript support
  for descriptor modules and transport binding modules,
  plus pre-compiled workflow modules (`run`, `check`)
- workflow invocation input parsing from CLI flags (`run`)
- startup lifecycle orchestration (`run`)
- diagnostics formatting and process lifecycle (all commands)

The CLI is NOT responsible for:

- IR lowering or validation (compiler)
- IR execution, replay, or transport management (runtime)
- descriptor data model, constructor vocabulary, or
  `Config.useConfig()` semantics (config specification)
- transport protocols (transport specification)
```

---

### A2. §10.1 Step 1 — Amend module loading

Replace step 1:

```
1. **Module loading.** Load the module at `<module>` via
   the bootstrap loading path (§10.5) and extract its
   `default` export. Both TypeScript (`.ts`, `.mts`,
   `.cts`) and JavaScript (`.js`, `.mjs`, `.cjs`)
   descriptor modules are first-class inputs.

   If the module cannot be located or read, fail with
   exit code 3. If the file extension is not supported,
   fail with exit code 3. If the default export is not a
   valid `WorkflowDescriptor`, fail with exit code 2.
```

---

### A3. §10.1 Step 2 — Amend run target resolution

Replace step 2:

```
2. **Run target resolution.** Resolve the descriptor's
   `run` field to a workflow function. If `run.module`
   is specified, determine the loading path:

   - If `run.module` points to a `.ts` source file, the
     CLI compiles the workflow at runtime using the Tisyn
     compiler (§10.5.4). This is source compilation, not
     module loading.
   - If `run.module` points to a `.js` file, the CLI
     loads the pre-compiled module via the bootstrap
     loading path (§10.5) and locates the named export.

   If `run.module` is omitted, locate the named export
   in the same module that produced the descriptor
   (§10.2). If the export does not exist, fail with
   exit code 2.
```

---

### A4. §10.1 Step 10 — Amend transport module loading

In the existing step 10, replace the paragraph about
loading local/inprocess module bindings. The current text
says:

> Load local/inprocess module bindings. For each binding
> that provides a `bindServer` hook, call it with the
> server binding.

Replace with:

```
   Load local/inprocess module bindings via the bootstrap
   loading path (§10.5). Both TypeScript and JavaScript
   transport binding modules are supported. For each
   binding that provides a `bindServer` hook, call it
   with the server binding.
```

---

### A5. New §10.5 — Module Loading

Insert as a new subsection after §10.4 (Combined Error
Reporting) and before §11 (Validation Summary):

```
### 10.5 Module Loading

#### 10.5.1 Supported Module Inputs

`tsn run` and `tsn check` accept both TypeScript and
JavaScript descriptor modules as the `<module>` argument:

| Extension | Status |
|-----------|--------|
| `.ts`     | Supported |
| `.mts`    | Supported |
| `.cts`    | Supported |
| `.js`     | Supported |
| `.mjs`    | Supported |
| `.cjs`    | Supported |

The same extensions are supported for all module-loading
sites: descriptor modules, workflow modules (when
`run.module` points to a pre-compiled `.js` file), and
transport binding modules (referenced by
`transport.local()` and `transport.inprocess()`).

`.tsx` is NOT supported. Descriptor modules, workflow
modules, and transport binding modules have no use case
for JSX syntax. This MAY be revised if a use case emerges.

#### 10.5.2 Bootstrap Loading

Module loading for `tsn run` and `tsn check` occurs
before any Effection scope exists (steps 1–5 of §10.1
precede scope creation in step 10). The CLI uses a
bootstrap loading path — a plain async function — for
all pre-scope module loading.

The bootstrap loading path determines the loading
strategy based on the resolved file extension:

- TypeScript-family extensions (`.ts`, `.mts`, `.cts`)
  are loaded using the `tsImport()` API from the `tsx`
  package. This is a scoped loading mechanism: it does
  not register global Node.js loader hooks and does not
  affect how other code loads modules. Caching behavior
  is an implementation detail of `tsx` and is not part
  of this contract.

- JavaScript-family extensions (`.js`, `.mjs`, `.cjs`)
  are loaded using Node.js native `import()`.

The extension-to-strategy mapping is internal default
behavior. It is not a public contract and is not
configurable via CLI flags.

`@tisyn/cli` MUST declare `tsx` as a direct dependency
(not peer or optional). `tsx` is imported lazily: the
`tsx/esm/api` module is loaded only when a TypeScript-
family file is encountered. If the user only provides
JavaScript modules, `tsx` is never loaded.

#### 10.5.3 Shared Default Implementation

The bootstrap loading path MUST be implemented so that
it can serve as the default core handler for the scoped
`Runtime.loadModule` capability described in §10.5.6.

In practice, this means extracting the extension-
dispatched loading into a shared internal function.
The bootstrap path calls this function directly. The
future `Runtime.loadModule` core handler MUST delegate
to the same function, ensuring that pre-scope and
in-scope module loading behave identically by default.

#### 10.5.4 Module Loading vs. Workflow Source Compilation

The CLI has two distinct paths for obtaining workflow IR.
These are architecturally separate:

**Module loading** (this section). When `run.module`
points to a `.js` file, the CLI loads the pre-compiled
module and extracts the named IR export. The module was
produced by `tsn generate` or `tsn build`. Module loading
evaluates the module and returns its exports.

**Source compilation** (compiler specification). When
`run.module` points to a `.ts` workflow source file, the
CLI reads the source text and passes it through the Tisyn
compiler to produce IR. This is source analysis, not
module loading. The compiler operates on text, not on
evaluated modules.

Module loading MUST NOT replace workflow source
compilation. When `run.module` is a `.ts` workflow source,
the CLI MUST use the Tisyn compiler to produce IR.
Loading the `.ts` file as a module via `tsImport()` would
produce runtime values, not inspectable IR.

Module loading (via `tsImport()` or `import()`) is for
descriptor modules and transport binding modules —
modules that produce runtime JavaScript values (descriptor
objects, transport factories).

#### 10.5.5 Module Loading Errors

Module loading introduces the following error categories.
All are reported with exit code 3 (I/O error) unless
otherwise noted.

**Unsupported extension.** The file extension is not
recognized. Diagnostic: "Unsupported file extension
'{ext}'. Supported: .ts, .mts, .cts, .js, .mjs, .cjs".

**Module not found.** The file does not exist at the
resolved path. Diagnostic: "Module not found: '{path}'".

**Syntax error.** The TypeScript or JavaScript source
contains a parse error. For TypeScript files, the
esbuild error includes file path, line, column, and
source text. The CLI SHOULD format a readable diagnostic
with source context:

    Syntax error in './descriptor.ts':
      12 |   agents: [
      13 |     agent("coder" {
         |                   ^ Expected ',' or ')'
      14 |       transport: transport.local("./coder.ts"),

**Loader initialization failure.** The `tsx` package
cannot be loaded. Diagnostic: "TypeScript loader failed
to initialize. Ensure @tisyn/cli dependencies are
installed."

**Module evaluation failure.** The module loads but
throws during evaluation. Diagnostic: "Failed to load
module '{path}': {error.message}".

After a module loads successfully, export validation
errors (missing default export, invalid
`WorkflowDescriptor`, missing named export) are
reported with exit code 2 per existing rules (§3.4).

#### 10.5.6 Architectural Alignment: Runtime

The bootstrap loading path defined in this section is
architecturally aligned with a scoped runtime capability
that this specification does not itself define.

The intended scoped model is `Runtime` — a context API
created via `createApi()`, following the same pattern as
`Effects`. `Runtime` exposes `loadModule` as a middleware-
interceptable capability:

    yield* Runtime.loadModule(specifier, parentURL);

Middleware is installed via `Runtime.around()`:

    yield* Runtime.around({
      *loadModule([specifier, parentURL], next) {
        // intercept, constrain, redirect, or delegate
        return yield* next(specifier, parentURL);
      },
    });

`Runtime` and `Effects` are independent peer context
APIs. `Runtime.around()` follows the same semantics as
`Effects.around()`: middleware is stored in Effection
context, scoped to the current scope, inherited by
children, and child installations do not affect the
parent.

The bootstrap loading path (§10.5.2) is the pre-scope
analogue of this capability. It exists because descriptor
loading occurs before any scope exists. It is CLI-owned
plumbing, not an extensibility abstraction.

The shared default implementation rule (§10.5.3) ensures
that bootstrap loading and the future scoped
`Runtime.loadModule` core handler use the same
underlying loading strategy. This prevents behavioral
drift between pre-scope and in-scope module loading.

The `Runtime` context API itself — its package placement,
its full operation set, and its normative semantics — is
deferred to a separate specification or amendment when
a scoped consumer exists. This section establishes the
architectural intent so that the bootstrap implementation
is designed to align with it, not to normatively define
the runtime-side API surface.
```

---

## B. Secondary Amendment Assessment

**No secondary amendment is needed for this CLI spec
change to proceed.**

The CLI spec treats `Runtime` as architectural alignment
text (§10.5.6), not as a normatively defined runtime API.
The CLI spec can be merged and implemented without any
changes to other specifications.

When the `Runtime` context API is actually implemented as
a scoped capability (i.e., when a scoped consumer of
`Runtime.loadModule` exists), a small amendment to the
relevant runtime or context-API area will be needed to
normatively define `Runtime`, its operations, and its
`around()` semantics. That amendment should be authored
at that time, scoped to what the consumer requires.

The CLI spec's §10.5.6 is written to align with this
future amendment without depending on it. The bootstrap
loading path and the shared default implementation rule
(§10.5.3) are self-contained CLI-owned contracts that do
not require runtime-side specification to be actionable.

---

## C. Section Placement Plan

| Location in CLI spec | Change | Content source |
|---|---|---|
| §1.2 (Scope) | Amend responsibility list | A1 above |
| §10.1 step 1 | Replace step text | A2 above |
| §10.1 step 2 | Replace step text | A3 above |
| §10.1 step 10 | Replace paragraph | A4 above |
| New §10.5 | Insert before §11 | A5 above |

The version header should be bumped to 0.4.0.

No other sections require changes. In particular:

- §2.3 (`tsn run` command description) — no change
  needed. The `<module>` argument description ("Path to
  a module exporting a WorkflowDescriptor as its default
  export") is already extension-agnostic.

- §2.4 (`tsn check` command description) — same. Already
  extension-agnostic.

- §3.4 (Exit codes) — no change needed. Exit code 3
  already covers "module not found, file not readable."
  The new error categories (unsupported extension, syntax
  error, loader bootstrap) all map to exit code 3.

- §10.2 (Module Contracts) — no change needed. The
  contracts M1, M2, M3 are already format-agnostic.

- §10.3, §10.4 — no change needed.

- §11 (Validation Summary) — no change needed. Module
  loading errors (exit code 3) are distinct from
  validation errors (exit codes 2, 4, 5).

---

## D. Cleanup List

After the merge, the following are redundant and should
be deleted:

1. **`tisyn-module-loader-spec.md` (standalone v0.2.0)**
   — entirely absorbed into the CLI spec. Delete.

2. **`tisyn-module-loader-analysis.md`** — companion
   analysis document. Its content informed the design
   but is not normative. Delete.

3. **The earlier research artifact** (extended search
   task output on tsImport/tsx integration) — superseded.
   Not a spec document; no action needed.

Nothing from the standalone spec is lost:

| Standalone spec section | Where it went |
|---|---|
| §1 Overview | CLI §10.5.6 (architectural note) |
| §2 Problem | Absorbed into rationale for CLI §10.5 |
| §3 Named Concepts | `Runtime`, `Runtime.loadModule`, `Runtime.around` → CLI §10.5.6. `ModuleExports`, bootstrap helper → not named in CLI spec (implementation detail). |
| §4 Scoped Middleware Model | CLI §10.5.6 (shows `around()` pattern) |
| §5 Default Implementation | CLI §10.5.2 (bootstrap loading describes the strategy). CLI §10.5.3 (shared default). |
| §6 Bootstrap Loading | CLI §10.5.2, §10.5.3 |
| §7 Call Site Migration | CLI §10.1 steps 1, 2, 10 (amended) |
| §8 Workflow Source Compilation | CLI §10.5.4 |
| §9 Error Model | CLI §10.5.5 |
| §10 How Other Features Build | Covered by CLI §10.5.2 (all loading sites) and §10.5.6 (Runtime is the normative model) |
| §11 Normative Design Rules | R1-R8 absorbed into normative language throughout §10.5. Key rules: shared default (§10.5.3), tsx as direct dependency (§10.5.2), bootstrap is plumbing (§10.5.6). |
| §12 Spec Impact | This document IS the spec impact. |
| §13 Implementation Plan | Not normative; lives in issue tracker or implementation memo. |
| §14 Open Questions | Q1 (package placement) → implementation decision. Q2 (watch mode) → deferred, not spec. Q3 (Node.js floor) → implementation decision. |
| §15 Summary of Named Concepts | Absorbed into §10.5.6. |
| Appendix: Correction Plan | Superseded by this merge. |

---

## E. Implementation Notes (Non-Normative)

The CLI spec amendments above are sufficient to implement
the feature. The implementation sequence is:

1. Extract the default loading function (extension-
   dispatched, tsImport/import) into a shared internal
   module.
2. Add `tsx` as a direct dependency of `@tisyn/cli`.
3. Implement the bootstrap helper using the shared
   function.
4. Refactor `loadDescriptorModule()`,
   `loadWorkflowExport()`, and `loadLocalBinding()` to
   use the bootstrap helper.
5. Implement structured error handling per §10.5.5.
6. Create the `Runtime` context API via `createApi()` in
   the appropriate package, wiring its core handler to
   the same shared function.

Tests to add:

- Bootstrap helper loads `.js` module.
- Bootstrap helper loads `.ts` module.
- Bootstrap helper rejects unsupported extension.
- `tsn run ./descriptor.ts` succeeds end-to-end.
- `tsn check ./descriptor.ts` succeeds end-to-end.
- `tsn run ./descriptor.js` behavior unchanged.
- Syntax error in `.ts` descriptor produces readable
  diagnostic with file, line, column.
- Missing `.ts` file produces clear "not found" message.
- `Runtime.loadModule()` loads `.ts` and `.js` modules
  in-scope.
- `Runtime.around()` can intercept, deny, and redirect
  `loadModule`.
- Child scope inherits parent's `Runtime` middleware.
