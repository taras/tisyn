# @tisyn/compiler

## 0.6.0

### Patch Changes

- e4dc3d9: Update scope teardown test to reflect built-in sleep handler — assert `null` (built-in) instead of `"clean"` (caught error) after scoped middleware tears down.
  - @tisyn/ir@0.6.0
  - @tisyn/validate@0.6.0

## 0.5.2

### Patch Changes

- @tisyn/ir@0.5.2
- @tisyn/validate@0.5.2

## 0.5.1

### Patch Changes

- @tisyn/ir@0.5.1
- @tisyn/validate@0.5.1

## 0.5.0

### Minor Changes

- e71915d: Add compiler support for `yield* scoped(function* () { ... })`.

  - New `emitScoped` compiles the scoped generator function: partitions statements into setup (`yield* useTransport(...)`, `yield* Effects.around(...)`) and body; emits `ScopeEval(handler, bindings, bodyExpr)`
  - New `emitEffectsAround` compiles `Effects.around({ *dispatch([id, data], next) { ... } })` to a `FnNode` for use as the scope's enforcement handler
  - New `emitMiddlewareBody` compiles the dispatch handler body (supports `return`, `const`, `if`/`if-else`, `throw new Error`, `yield* next(a, b)`)
  - `useAgent(Contract)` declarations inside a scoped body are erased at compile time; the variable name is recorded in `handleBindings` for method-call lowering
  - `yield* handle.method(args)` inside a scoped body is lowered to `ExternalEval("prefix.method", Construct(fields))` using the contract's method signature
  - New `ScopeEval(handler, bindings, body)` IR builder added to `ir-builders.ts` and exported from the package index

- 9786a15: Compile `yield* spawn(function*() { ... })` and `yield* task` (join).

  - `yield* spawn(fn)` lowers to `SpawnEval(bodyExpr)`; `yield* task` lowers to `JoinEval(Ref("task"))`
  - Scope-aware spawn-handle tracking via `BindingInfo.isSpawnHandle` / `isForbiddenCapture`
  - Enforce SP1 (generator arg), SP2 (const binding), SP4 (handle expression restriction), SP11 (parent handle not capturable)
  - Add `SpawnEval` and `JoinEval` IR builders; add `"Spawn"` and `"Join"` to codegen constructor list

### Patch Changes

- d4a051a: Widen `useTransport` second argument to accept any expression.

  Previously the factory argument was restricted to a bare identifier (enforced by compile-time UT2/UT3 checks). It now accepts any expression that evaluates to an `AgentTransportFactory` without performing effects — property accesses, call expressions, ternaries, etc.

  - Remove UT2 (bare-identifier) and UT3 (must be in scope) error checks
  - Emit the factory argument via `emitExpression()` instead of constructing a `RefNode` directly
  - Update `ScopeEval()` builder signature to accept `Record<string, Expr>` bindings
  - Remove UT2 and UT3 from the compiler README error-code table

- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0
  - @tisyn/validate@0.5.0

## 0.4.0

### Patch Changes

- @tisyn/ir@0.4.0
- @tisyn/validate@0.4.0

## 0.3.0

### Minor Changes

- 473f5ab: Support `return` inside `try` and `catch` clause bodies via outcome packing. When a `return` is present in a `try` or `catch` body, the compiler activates packing mode: every normal exit is lowered to `Construct({ __tag, __value, ...joinVars })`, and a post-Try dispatch inspects `__tag` to suppress the continuation (`"return"`) or continue it (`"fallthrough"`). `return` inside `finally` remains a compile error (E033 narrowed from try/catch/finally to finally-only).
- 4375b0a: Add `emitTryStatement` to lower TypeScript `try/catch/finally` AST nodes to Tisyn IR. Handles SSA join variables across branches via `finallyPayload` and an inner-Try fallback (`Let(x_1, Try(Ref(fp), err, Ref(x_0_pretrial)), body)`) that safely resolves the finally context on both success and error paths without introducing new IR fields. New compiler errors: E033 (return in try/catch/finally), E034 (catch without binding), E035 (outer-binding assignment in finally).

### Patch Changes

- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0
  - @tisyn/validate@0.3.0

## 0.2.0

### Minor Changes

- 5551c2d: Add the `generateWorkflowModule` API for ambient service-factory code generation,
  strengthen contract-signature validation and type discovery, improve generated-module
  correctness, and preserve correct while-loop lowering for per-iteration bindings.
- 3302f6a: Add local-state authoring support via SSA lowering for `let` bindings and reassignment,
  including authored array/object spread support for workflow-local state patterns like
  chat history accumulation.

### Patch Changes

- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
- Updated dependencies [3302f6a]
  - @tisyn/ir@0.2.0
  - @tisyn/validate@0.2.0
