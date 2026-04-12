# Tisyn Compiler Test Plan

**Tests:** Tisyn Compiler Specification

---

## 1. Test Plan Overview

This test plan defines the conformance tests for the rooted
import-graph compilation model. Tests validate observable
behavior of the compiler's `compileGraph` entry point and
its diagnostics.

### 1.1 Test Methodology

Compiler tests invoke `compileGraph` with an in-memory
`readFile` callback. Tests observe only the public result
surface:

- `result.source` — the emitted artifact text
- `result.graph.modules` — module classification by path
- `result.graph.compiled` — compiled symbol names
- `result.graph.traversed` — traversed module paths
- thrown `CompileError` — error code and diagnostic content

Tests MUST NOT assert against internal compiler state or
exact synthetic helper names. They SHOULD assert naming
properties rather than exact generated spellings.

### 1.2 Tiering

**Core** tests validate behavior essential for conformance.
A compiler that fails any Core test does not conform.

**Extended** tests validate edge cases and combinations. A
conforming compiler SHOULD pass Extended tests but MAY
defer them.

---

## 2. Fixture Schema

```typescript
interface CompilerFixture {
  id: string;
  description: string;
  files: Record<string, string>;
  roots: string[];
  generatedModulePaths?: string[];
  format?: "printed" | "json";
  expected:
    | CompilerFixtureSuccess
    | CompilerFixtureRejection;
}

interface CompilerFixtureSuccess {
  outcome: "success";
  modules: Record<string, {
    category: ModuleCategory;
    participation?: ("implementation" | "declaration")[];
  }>;
  traversed: string[];
  compiled: string[];
  notCompiled?: string[];
  entrypoints: string[];
  artifactContains?: string[];
  artifactExcludes?: string[];
  warnings?: string[];
}

interface CompilerFixtureRejection {
  outcome: "rejection";
  code: string;
  diagnosticContains: {
    symbolName?: string;
    modulePath?: string;
    reason?: string;
    constructName?: string;
    constructLocation?: string;
  };
}
```

---

## 3. Module Graph Construction Tests

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| IG-001 | Core | §14 G1 | Single root, no imports | Compile | Graph has one workflow-implementation module |
| IG-002 | Core | §14 G2-G4 | Root imports `./helper.ts` | Compile | Both modules traversed |
| IG-003 | Core | §2.3 | Import `./helper` (no extension) | Compile | `E-IMPORT-002` |
| IG-004 | Core | §2.3 | Import `"lodash"` | Compile | External boundary; not traversed |
| IG-005 | Core | §2.3 | Import `"node:fs"` | Compile | External boundary; not traversed |
| IG-006 | Core | §20 GM1 | Import from path in `generatedModulePaths` | Compile | Generated boundary; not traversed |
| IG-007 | Core | §20 GM2 | Import file with auto-generated banner | Compile | Generated via heuristic |
| IG-008 | Core | §2.3 | `import type { T } from "./types.ts"` | Compile | Type-only boundary; forwarded |
| IG-009 | Core | §2.3 | Import `./missing.ts` | Compile | `E-IMPORT-003` |
| IG-010 | Core | §14 | Chain root → A → B → C | Compile | All modules traversed |
| IG-011 | Core | §14 | Circular imports | Compile | No error; visited set prevents re-entry |
| IG-012 | Core | §14 | Import utility-only module; symbol never referenced | Compile | Read for classification; no error |
| IG-013 | Core | §14 | Contract module imports type-only module | Compile | Contract traversed; type-only not traversed |
| IG-014 | Core | §2.3 | Bare specifier used for contract | Compile | `E-IMPORT-001` |
| IG-015 | Extended | §14 | Diamond graph | Compile | Shared dependency traversed once |
| IG-016 | Extended | §15 | Module reached by type-only and value import | Compile | Value-import classification wins |

---

## 4. Module Classification Tests

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| MC-001 | Core | §15 | Module with `export function* wf() {}` | Compile | Workflow implementation |
| MC-002 | Core | §15 | Module with `export const wf = function*() {}` | Compile | Workflow implementation |
| MC-003 | Core | §15 | Module with only contract declarations | Compile | Contract declaration |
| MC-004 | Core | §15 | Module with only types/interfaces | Classify | External |
| MC-005 | Core | §15 | Non-generator returning workflow IR, referenced from entrypoint | Compile | Workflow implementation |
| MC-006 | Core | §15 | Non-generator with unsupported body, referenced from entrypoint | Compile | External and `E-HELPER-001` |
| MC-007 | Core | §15 | Module with generator and contract | Compile | Workflow implementation; both participation kinds |
| MC-008 | Core | §15 | Contract module with qualifying non-generator helper | Compile | Reclassified to workflow implementation |
| MC-009 | Core | §20 | Path in `generatedModulePaths` | Compile | Generated |
| MC-010 | Core | §15 | Reached only via `import type` | Compile | Type-only |
| MC-011 | Extended | §15 | Module with only `export const x = 3` | Classify | External |
| MC-012 | Extended | §15 | Module with only `export class Foo {}` | Classify | External |

---

## 5. Symbol Extraction and Reachability Tests

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| SE-001 | Core | §16 ER1 | Exported `function*` | Compile | Entrypoint; compiled |
| SE-002 | Core | §16 ER1 | Exported `const wf = function*()` | Compile | Entrypoint; compiled |
| SE-003 | Core | §16 ER2 | Entrypoint calls same-file helper | Compile | Helper in closure; compiled |
| SE-004 | Core | §16 ER3 | Entrypoint imports helper from another module | Compile | Resolved via export map; compiled |
| SE-005 | Core | §16 ER4 | Exported symbol not called from any entrypoint | Compile | Not compiled; warning optional |
| SE-006 | Core | §16 ER5 | No generators in graph | Compile | `E-GRAPH-001` |
| SE-007 | Core | §16 ER2 | Transitive entrypoint → A → B | Compile | Both helpers compiled |
| SE-008 | Core | §16.3 | Mutual recursion across modules | Compile | SCC/letrec emission |
| SE-009 | Core | §16 | Renamed export map entry | Compile | Import resolves to local declaration |
| SE-010 | Core | §16.3 | Emission ordering deterministic | Compile twice | Identical order |

---

## 6. Helper Compilation Tests

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| HC-001 | Core | §17 | Generator helper | Compile | `Fn` binding and `Call` at call site |
| HC-002 | Core | §17 | Expression helper returning `resource(...)` | Compile | `Fn(params, ResourceEval(...))` |
| HC-003 | Core | §17 | Cross-module helper via import | Compile | Separate helper binding emitted |
| HC-004 | Core | §17 | Cross-module helper is not inlined | Compile | Separate `Fn` binding remains |
| HC-005 | Core | §17 | Helper body with `new Date()` | Compile | `E-HELPER-001` |
| HC-006 | Core | §17 | Helper body with `fetch(...)` | Compile | `E-HELPER-001` |
| HC-007 | Core | §17 | Helper with free variable bound at call site | Compile | Accepted |
| HC-008 | Core | §17 | Compiled helper body contains only IR nodes | Compile | No JS runtime references in output |
| HC-009 | Core | §17 | Self-recursive generator helper | Compile | Accepted |
| HC-010 | Core | §17 | Expression helper returning `scoped(...)` | Compile | `Fn(params, ScopeEval(...))` |
| HC-011 | Core | §17 | Expression helper returning `timebox(...)` | Compile | `Fn(params, TimeboxEval(...))` |
| HC-012 | Core | §17 | Expression helper with `const` before return | Compile | `Fn(params, Let(...))` |
| HC-013 | Extended | §17 | Arrow helper export | Compile | Qualifies and emits as `Fn` |
| HC-014 | Extended | §17 | Const-bound function helper export | Compile | Qualifies and emits as `Fn` |
| HC-015 | Extended | §17 | Expression helper calling another helper | Compile | Both compiled; `Call` chain |
| HC-016 | Extended | §17 | Expression helper with `if/else` | Compile | `Fn(params, If(...))` |

---

## 7. Contract Visibility and Naming Tests

### 7.1 Contract Visibility

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| CV-001 | Core | §18 | Contract in same module as workflow | Compile | In scope; accepted |
| CV-002 | Core | §18 | Contract imported from contracts module | Compile | In scope; accepted |
| CV-003 | Core | §18 | Contract declared elsewhere but not imported | Compile | Rejected |
| CV-004 | Core | §18 | Two modules import same contract | Compile | Both accepted |
| CV-005 | Core | §18 | Module A imports contract; B does not | Compile | A accepted; B rejected |
| CV-006 | Core | §2.3 | Contract via bare specifier | Compile | `E-IMPORT-001` |
| CV-007 | Core | §18 | Contract-only module | Compile | No `Fn` binding emitted |
| CV-008 | Extended | §18 | Transitive contract chain without direct import | Compile | Workflow must still import directly |
| CV-009 | Extended | §18 | Two contracts imported from two modules | Compile | Both visible |

### 7.2 Name Conflicts

| ID | Tier | Rule | Setup | Action | Expected |
| --- | --- | --- | --- | --- | --- |
| NC-001 | Core | §19 | Two modules export same-named generator | Compile | `E-NAME-001` |
| NC-002 | Core | §19 | Generator and expression helper share name across modules | Compile | `E-NAME-001` |
| NC-003 | Core | §19 | Two modules export same-named contract | Compile | `E-NAME-001` |
| NC-004 | Core | §19 | Compiler does not silently rename conflicts | Compile | Rejection, not renamed output |
| NC-005 | Core | §21 | Two non-exported same-named helpers in different modules | Compile | Accepted; distinct emitted names |
| NC-006 | Extended | §19 | Same export name but only one reachable | Compile | Accepted |

---

## 8. Artifact Identity and Determinism Tests

### 8.1 Same Inputs → Same Artifact

| ID | Tier | Property | Setup | Expected |
| --- | --- | --- | --- | --- |
| AI-DET-001 | Core | §22 | Multi-module graph; compile twice | Byte-identical output |
| AI-DET-002 | Core | §22 | Same graph in `json` format; compile twice | Byte-identical output |

### 8.2 Changed Relevant Input → Different Artifact

| ID | Tier | Property | Setup | Expected |
| --- | --- | --- | --- | --- |
| AI-CHG-001 | Core | §22 | Modify helper body; recompile | Different output |
| AI-CHG-002 | Core | §22 | Add reachable helper; recompile | Different output |
| AI-CHG-003 | Core | §22 | Remove reachable helper; recompile | Different output |
| AI-CHG-004 | Core | §22 | Add new imported module to the graph; recompile | Different output |

### 8.3 Format Differences

| ID | Tier | Property | Setup | Expected |
| --- | --- | --- | --- | --- |
| AI-FMT-001 | Core | §3 | Same graph compiled as `printed` and `json` | Different text; each deterministic |

### 8.4 Emitted Naming

| ID | Tier | Property | Setup | Expected |
| --- | --- | --- | --- | --- |
| AI-NAME-001 | Core | §21 | Exported `processOrder` | Emitted name is `processOrder` |
| AI-NAME-002 | Core | §21 | Two non-exported `helper` symbols in different modules | Distinct emitted names |
| AI-NAME-003 | Core | §21 | Recompile without changes | Same non-exported names |

### 8.5 Generated-Module Boundaries

| ID | Tier | Property | Setup | Expected |
| --- | --- | --- | --- | --- |
| AI-GEN-001 | Core | §20 | Root imports generated module | Output contains runtime `import { ... }` |
| AI-GEN-002 | Extended | §22 | Change generated module; recompile importing pass | Output changes |

---

## 9. Diagnostic Quality Tests

| ID | Tier | Rule | Setup | Expected |
| --- | --- | --- | --- | --- |
| DG-001 | Core | `E-IMPORT-001` | Non-intrinsic bare specifier value import | Code, symbol name, and specifier present |
| DG-001a | Core | §2.3.1 | Compiler-intrinsic bare specifier value import (e.g. `resource`, `provide` from `@tisyn/agent`) | Accepted; no error |
| DG-002 | Core | `E-IMPORT-002` | No extension | Code and specifier present |
| DG-003 | Core | `E-IMPORT-003` | Missing file | Code and resolved path present |
| DG-004 | Core | `E-IMPORT-004` | Utility module symbol used | Code, module path, and reason present |
| DG-005 | Core | `E-IMPORT-005` | Non-exported import target | Code, symbol, and target module present |
| DG-006 | Core | `E-IMPORT-006` | Dynamic import | Code and location present |
| DG-007 | Core | `E-IMPORT-007` | Default import | Code and form kind present |
| DG-008 | Core | `E-IMPORT-007` | Namespace import | Code and form kind present |
| DG-009 | Core | `E-IMPORT-007` | Re-export | Code and form kind present |
| DG-010 | Core | `E-HELPER-001` | `Math.random()` in helper | Code, construct name, and body location present |
| DG-011 | Core | `E-HELPER-001` | `.push()` in helper | Code, construct name, and body location present |
| DG-012 | Core | `E-NAME-001` | Duplicate name | Code, both paths, and both locations present |
| DG-013 | Core | `E-GRAPH-001` | No entrypoints | Code and root path present |
| DG-014 | Core | `W-GRAPH-001` | Unreachable exported symbol | Code, symbol, and module present |
| DG-015 | Core | DQ1-DQ3 | Any rejection | Symbol name, module path, and reason present |
| DG-016 | Core | DQ5 | `E-IMPORT-004` | Explains external classification |
| DG-017 | Extended | §2.3 | Bare-specifier `import type` | Accepted; no error |
| DG-018 | Extended | `E-IMPORT-001` | `node:path` value import | Rejected with `E-IMPORT-001` |
| DG-019 | Core | `E-GRAPH-002` | `compileGraphForRuntime` with non-existent export name | Code, requested export name, and available exports present |

### 9.1 Required Content Matrix

| Code | Required content |
| --- | --- |
| `E-IMPORT-001` | Symbol name, specifier, importing module path |
| `E-IMPORT-002` | Specifier string, importing module path |
| `E-IMPORT-003` | Resolved path, importing module path |
| `E-IMPORT-004` | Symbol name, target module path, classification reason |
| `E-IMPORT-005` | Symbol name, target module path |
| `E-IMPORT-006` | Source location |
| `E-IMPORT-007` | Import form kind, source location |
| `E-HELPER-001` | Symbol name, declaring module, construct name, construct location |
| `E-NAME-001` | Symbol name, both module paths, both source locations |
| `E-GRAPH-001` | Root path(s) |
| `E-GRAPH-002` | Requested export name, available exports, source path |
| `W-GRAPH-001` | Symbol name, declaring module path |

---

## 10. Runtime Binding Resolution (`compileGraphForRuntime`)

| ID | Description | Fixture |
| --- | --- | --- |
| RT-001 | Same-file helper produces correct emitted-name binding | Single root: exported generator + non-exported helper |
| RT-002 | Cross-module import produces correct emitted-name binding | Root imports helper from `./utils.ts` |
| RT-003 | Aliased import resolves to target's emitted name | `import { helper as h }` |
| RT-004 | Two modules with same-named `helper` → distinct emitted-name bindings | Root calls `processA`/`processB` from `./a.ts`/`./b.ts`, each with own `helper` |
| RT-005 | Per-export scoping: only selected export's reachable bindings included | Two exported workflows with separate helpers; select one |
| RT-006 | Execute with same-file helper succeeds | Compile + execute, assert return value |
| RT-007 | Execute with cross-module helper succeeds | Multi-file compile + execute |
| RT-008 | Execute with aliased import succeeds | Aliased import compile + execute |
| RT-009 | Execute with same-named helpers from different modules succeeds | Distinct helper values verified at runtime |
| RT-010 | Self-recursive exported workflow executes successfully | `countdown(n)` with `exportName` selection |
| RT-011 | Exported workflow with export name = parameter name produces no collision | Synthetic runtime name prevents shadowing |
| RT-012 | Self-recursive workflow with same-named parameter matches TypeScript scoping | Parameter shadows function name in non-recursive body |
| RT-013 | Reachable exported callee with export name = parameter name uses synthetic runtime name | Transitive callee with `helper(helper: number)` |
| RT-014 | Self-recursive exported callee reached transitively executes correctly | `main → helper(n)` where helper self-recurses |

---

## 11. Out of Scope

- Kernel evaluation semantics
- Journal replay semantics
- Runtime transport behavior
- Path alias resolution
- `node_modules` resolution beyond treating bare specifiers
  as graph boundaries
