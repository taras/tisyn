# @tisyn/kernel

## 0.16.0

### Patch Changes

- @tisyn/ir@0.16.0
- @tisyn/validate@0.16.0

## 0.15.0

### Patch Changes

- @tisyn/ir@0.15.0
- @tisyn/validate@0.15.0

## 0.14.0

### Patch Changes

- @tisyn/ir@0.14.0
- @tisyn/validate@0.14.0

## 0.13.0

### Patch Changes

- @tisyn/ir@0.13.0
- @tisyn/validate@0.13.0

## 0.12.0

### Patch Changes

- @tisyn/ir@0.12.0
- @tisyn/validate@0.12.0

## 0.11.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [37bbb63]
  - @tisyn/ir@0.11.0
  - @tisyn/validate@0.11.0

## 0.10.0

### Patch Changes

- ae8d61c: Enforce curly braces on all control flow statements.
- Updated dependencies [ae8d61c]
- Updated dependencies [7004d09]
  - @tisyn/ir@0.10.0
  - @tisyn/validate@0.10.0

## 0.9.0

### Patch Changes

- @tisyn/ir@0.9.0
- @tisyn/validate@0.9.0

## 0.9.0

### Minor Changes

- 38d9ffc: Add per-ID timebox evaluation rule — evaluates duration synchronously, keeps body as unevaluated Expr.

### Patch Changes

- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
  - @tisyn/ir@0.9.0
  - @tisyn/validate@0.9.0

## 0.8.0

### Patch Changes

- b515855: Verify `stream.subscribe` and `stream.next` classify as standard external effects with zero code changes. Added classification tests confirming the kernel's resolve path handles stream effect data correctly.
  - @tisyn/ir@0.8.0
  - @tisyn/validate@0.8.0

## 0.7.0

### Patch Changes

- f074970: Classify `resource` and `provide` as compound external operations so the kernel yields them for runtime orchestration.
- Updated dependencies [f074970]
- Updated dependencies [f074970]
  - @tisyn/ir@0.7.0
  - @tisyn/validate@0.7.0

## 0.6.0

### Patch Changes

- 1f58703: Fix quoted-payload execution bug where `resolve()` traversed into Quote contents, dispatching nested effects that should remain inert data.

  - Quote now strips one layer and returns contents as opaque data without further traversal
  - Nested Eval, Ref, or Quote nodes inside quoted payloads are preserved as values by origin/context
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

- e71915d: Recognize `"scope"` as a compound-external operation in the kernel classifier.

  - Add `"scope"` to `COMPOUND_EXTERNAL_IDS` set in `classify.ts` so the kernel routes scope eval nodes through the compound-external path rather than the standard external-eval dispatch path

- 9786a15: Classify `spawn` and `join` as compound-external operations.

  - Add `"spawn"` and `"join"` to `COMPOUND_EXTERNAL_IDS` in `classify.ts`

### Patch Changes

- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0
  - @tisyn/validate@0.5.0

## 0.4.0

### Minor Changes

- 0393e25: Add `ProhibitedEffectError` for scoped effects.

  - Add `ProhibitedEffectError` thrown when an IR middleware expression attempts to use any effect other than `dispatch`

### Patch Changes

- @tisyn/ir@0.4.0
- @tisyn/validate@0.4.0

## 0.3.0

### Minor Changes

- 4375b0a: Implement `"try"` evaluation in the kernel. Supports catch clauses (with optional binding), finally clauses (with optional `finallyPayload` binding to the body outcome value), and correct propagation of non-catchable errors. `EffectError` moved from `@tisyn/runtime` into `@tisyn/kernel` and re-exported for downstream use. `isCatchable` helper determines which errors a `try` node may catch.

### Patch Changes

- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0
  - @tisyn/validate@0.3.0

## 0.2.0

### Minor Changes

- 3302f6a: Add kernel evaluation support for the new local-state and structural spread IR forms while
  preserving deterministic replay semantics.

### Patch Changes

- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
- Updated dependencies [3302f6a]
  - @tisyn/ir@0.2.0
  - @tisyn/validate@0.2.0
