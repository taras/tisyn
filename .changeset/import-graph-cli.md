---
"@tisyn/cli": minor
---

Migrate CLI from single-file compilation to rooted import-graph pipeline

- Replace `input`/`include` with `roots` across generate command, config types, and resolved passes
- Rewrite `runGenerate` and `runBuild` to use `compileGraph` instead of `generateWorkflowModule` with source assembly
- Remove legacy source assembly pipeline: `assembleSource`, `expandPatterns`, `createStubBlock`, `stripImportsFromSource`
- Simplify `inferDependencyGraph` to scan only root files instead of assembled source maps
- Track prior output paths as `generatedModulePaths` for cross-pass generated-module resolution
- Replace `compileWorkflowFromSource` with `resolveWorkflowExport` using three-step dispatch: non-TS loads at runtime, TS with compiler banner loads at runtime, TS source compiles via `compileGraphForRuntime`
- Reject legacy `input` field in config with clear migration error message
- Validate `roots` as non-empty string array in config resolution
- Add output path writability validation to config (checks file and ancestor directory permissions)
- Update CLI tests for roots-based API and re-export rejection via E-IMPORT-007
