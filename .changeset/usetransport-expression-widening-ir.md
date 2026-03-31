---
"@tisyn/ir": patch
---

Widen `ScopeShape.bindings` from `RefNode` to `TisynExpr`.

Binding values in a scope node can now be any IR expression, not just a `RefNode`. This enables the compiler to lower `yield* useTransport(Contract, expr)` where `expr` is a property access, call, ternary, or any other expression.
