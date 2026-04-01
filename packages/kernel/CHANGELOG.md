# @tisyn/kernel

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
