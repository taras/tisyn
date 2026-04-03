---
"@tisyn/ir": minor
"@tisyn/kernel": minor
"@tisyn/validate": minor
"@tisyn/runtime": minor
"@tisyn/compiler": minor
---

Add timebox and converge support across all layers.

- **IR**: `TimeboxShape`, `TimeboxNode`, `Timebox` constructor, timebox cases in printer and decompiler
- **Kernel**: per-ID timebox evaluation rule — evaluates duration synchronously, keeps body as unevaluated Expr
- **Validation**: duration subtree restriction rejects external Evals; `TIMEBOX_DURATION_EXTERNAL` error code
- **Runtime**: `orchestrateTimebox` with structured concurrency — body wins on simultaneous completion (TB-R6), deterministic child ID allocation
- **Compiler**: `emitTimebox` and `emitConverge` lowering, `TimeboxEval` builder, `containsYieldStar` helper, error codes E-TB-01/02 and E-CONV-01 through E-CONV-09; `interval` is required with no default
