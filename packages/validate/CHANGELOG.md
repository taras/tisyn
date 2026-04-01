# @tisyn/validate

## 0.5.0

### Minor Changes

- e71915d: Add Level-2 semantic validation for `scope` eval nodes.

  - Validate that `scope` data is a `Quote` node (same requirement as structural ops)
  - Validate that `body` is present and not itself a `Quote` node (eval-position check)
  - Validate that `handler` is `null` or a `Fn` node
  - Validate that `bindings` is a plain object whose values are all `Ref` nodes

- 9786a15: Add validation rules for `spawn` and `join` IR nodes.

  - Spawn requires Quote data with a `body` field; body is an evaluation position
  - Join requires Ref data (not Quote)
  - Add `checkSpawnConstraints` and evaluation position entries for spawn/join

### Patch Changes

- d4a051a: Update scope validation for widened binding expressions.

  - Remove the constraint that each binding value must be a `RefNode`; binding values may now be any `TisynExpr`
  - Add binding values to the evaluation-position table for `"scope"` so that a `QuoteNode` appearing directly as a binding value triggers `QUOTE_AT_EVAL_POSITION`

- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0

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
