# @tisyn/compiler

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
