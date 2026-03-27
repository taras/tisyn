# @tisyn/compiler

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
