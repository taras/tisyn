# @tisyn/kernel

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
