---
"@tisyn/dsl-parser": minor
---

Add `@tisyn/dsl-parser` — a recursive-descent parser that lowers Tisyn Constructor DSL text into Tisyn IR. It is the inverse of `@tisyn/ir#print()`: every string `print()` produces parses back to structurally identical IR.

Public API: `parseDSL` (throws on failure), `parseDSLSafe` (discriminated result, never throws), `parseDSLWithRecovery` (auto-close repair for truncated LLM output), and `tryAutoClose`.
