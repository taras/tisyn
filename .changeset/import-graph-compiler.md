---
"@tisyn/compiler": minor
---

Unify compiler surface and improve import-graph compilation

- Route `generateWorkflowModule()` through `runSingleSourcePipeline`, eliminating the legacy single-file compilation path
- Expand `CompileGraphResult` with `contracts`, `workflows`, `helpers`, and `warnings` fields
- Emit import-boundary diagnostics: E-IMPORT-001 (bare specifier in reachable code), E-IMPORT-004 (module with no workflow-relevant declarations), E-IMPORT-005 (missing export)
- Surface W-GRAPH-001 warnings for unreachable exported symbols
- Implement generated-module modeling: GM3 (symbol extraction), GM4 (placeholder entries), GM5 (contract discovery), GM8 (skip compilation)
- Add module reclassification after Stage 5 (MC8: workflow-implementation → external, MP2: contract-declaration → workflow-implementation)
- Validate contract type nodes for unsupported operators (typeof, keyof, readonly, unique) during discovery
- Add contract-symbol name conflict detection (E-NAME-001)
- Use sorted JSON serialization for deterministic output in JSON format mode
- Add `provenance` and `nonFunctionExports` fields to `ModuleInfo`
