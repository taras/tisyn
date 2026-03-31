---
"@tisyn/compiler": minor
---

Add compiler support for `yield* scoped(function* () { ... })`.

- New `emitScoped` compiles the scoped generator function: partitions statements into setup (`yield* useTransport(...)`, `yield* Effects.around(...)`) and body; emits `ScopeEval(handler, bindings, bodyExpr)`
- New `emitEffectsAround` compiles `Effects.around({ *dispatch([id, data], next) { ... } })` to a `FnNode` for use as the scope's enforcement handler
- New `emitMiddlewareBody` compiles the dispatch handler body (supports `return`, `const`, `if`/`if-else`, `throw new Error`, `yield* next(a, b)`)
- `useAgent(Contract)` declarations inside a scoped body are erased at compile time; the variable name is recorded in `handleBindings` for method-call lowering
- `yield* handle.method(args)` inside a scoped body is lowered to `ExternalEval("prefix.method", Construct(fields))` using the contract's method signature
- New `ScopeEval(handler, bindings, body)` IR builder added to `ir-builders.ts` and exported from the package index
