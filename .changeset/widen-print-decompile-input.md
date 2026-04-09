---
"@tisyn/ir": patch
---

Widen `print()` and `decompile()` to accept `IrInput` so phantom-typed IR nodes from constructors can be passed directly without `as TisynExpr` casts.
