# @tisyn/dsl

## 0.4.3

### Patch Changes

- Updated dependencies [37bbb63]
  - @tisyn/ir@1.0.0

## 0.4.2

### Patch Changes

- ae8d61c: Enforce curly braces on all control flow statements.
- Updated dependencies [ae8d61c]
- Updated dependencies [7004d09]
  - @tisyn/ir@0.10.0

## 0.4.1

### Patch Changes

- @tisyn/ir@0.9.0

## 0.4.0

### Minor Changes

- 8c4a62e: Add `Timebox` constructor and `Converge` macro to the Constructor DSL.

  - `Timebox(duration, body)` — 2-arg base constructor for timebox IR
  - `Converge(probe, until, interval, timeout)` — 4-arg macro that expands to the same IR shape as the compiler's `converge` lowering (timebox + recursive Fn + Call + sleep)

### Patch Changes

- Updated dependencies [38d9ffc]
  - @tisyn/ir@0.9.0

## 0.3.7

### Patch Changes

- @tisyn/ir@0.8.0

## 0.3.6

### Patch Changes

- Updated dependencies [f074970]
  - @tisyn/ir@0.7.0

## 0.3.5

### Patch Changes

- @tisyn/ir@0.6.0

## 0.3.4

### Patch Changes

- @tisyn/ir@0.5.2

## 0.3.3

### Patch Changes

- @tisyn/ir@0.5.1

## 0.3.2

### Patch Changes

- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0

## 0.3.1

### Patch Changes

- @tisyn/ir@0.4.0

## 0.3.0

### Minor Changes

- 4375b0a: Add `try` parsing and round-trip support to the Constructor DSL. The parser recognises `try { … } catch (e) { … } finally { … }` syntax (catch-only, finally-only, and catch+finally forms) and lowers it to `TryNode` IR. `print` renders the node back to the same syntax, completing the round-trip.

### Patch Changes

- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0

## 0.2.0

### Minor Changes

- e00e4db: Add `@tisyn/dsl` — a recursive-descent parser that lowers Tisyn Constructor DSL text into Tisyn IR. It is the inverse of `@tisyn/ir#print()`: every string `print()` produces parses back to structurally identical IR.

  Public API: `parseDSL` (throws on failure), `parseDSLSafe` (discriminated result, never throws), `parseDSLWithRecovery` (auto-close repair for truncated LLM output), `tryAutoClose`, and `print` (re-exported from `@tisyn/ir`).
