# @tisyn/validate

## 0.4.0

### Patch Changes

- @tisyn/ir@0.4.0

## 0.3.0

### Minor Changes

- 4375b0a: Add validation for the `"try"` IR node. Grammar walker checks required fields; semantic pass enforces the single-Quote rule and try-specific constraints: at least one of `catchBody` or `finally` must be present, `catchParam` requires `catchBody`, and `finallyPayload` requires `finally`.

### Patch Changes

- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0

## 0.2.0

### Minor Changes

- 3302f6a: Validate the new IR node shapes introduced by local-state authoring and structural spread
  lowering.

### Patch Changes

- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
  - @tisyn/ir@0.2.0
