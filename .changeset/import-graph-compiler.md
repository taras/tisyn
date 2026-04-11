---
"@tisyn/compiler": minor
---

Unify compiler surface, add runtime compilation, and support compiler intrinsics

- Workflows can now import compiler intrinsics like `resource()` and `provide()` from `@tisyn/agent` without triggering `E-IMPORT-001`
- Helper functions that wrap bare `resource(...)` calls now compile correctly
- Source execution can compile a selected workflow export together with the helper bindings it needs (`compileGraphForRuntime`)
- Selecting a missing export now fails with a clear `E-GRAPH-002` diagnostic listing available exports
- New public types: `CompileForExecutionOptions`, `RuntimeCompilationResult`
- Single-file compilation now routes through the unified import-graph pipeline
- Import-boundary diagnostics (`E-IMPORT-001`, `E-IMPORT-004`, `E-IMPORT-005`) and unreachable-symbol warnings (`W-GRAPH-001`) are now emitted
- Generated-module modeling (GM3, GM4, GM5, GM8), module reclassification (MC8, MP2), and contract-symbol name conflict detection (`E-NAME-001`) are implemented
- `CompileGraphResult` expanded with `contracts`, `workflows`, `helpers`, and `warnings` fields
