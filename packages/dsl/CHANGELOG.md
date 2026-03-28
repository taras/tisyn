# @tisyn/dsl

## 0.2.0

### Minor Changes

- e00e4db: Add `@tisyn/dsl` — a recursive-descent parser that lowers Tisyn Constructor DSL text into Tisyn IR. It is the inverse of `@tisyn/ir#print()`: every string `print()` produces parses back to structurally identical IR.

  Public API: `parseDSL` (throws on failure), `parseDSLSafe` (discriminated result, never throws), `parseDSLWithRecovery` (auto-close repair for truncated LLM output), `tryAutoClose`, and `print` (re-exported from `@tisyn/ir`).
