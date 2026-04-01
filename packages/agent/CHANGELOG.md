# @tisyn/agent

## 0.6.0

### Minor Changes

- e4dc3d9: Add `sleep` as a first-class Effects operation alongside `dispatch`.

  - `Effects.sleep(ms)` calls Effection's `sleep` directly
  - Core `dispatch` handler routes `effectId === "sleep"` to the built-in sleep operation
  - `Effects.around({ *dispatch })` middleware can still intercept sleep before the built-in runs

### Patch Changes

- Updated dependencies [1f58703]
  - @tisyn/kernel@0.6.0
  - @tisyn/ir@0.6.0

## 0.5.2

### Patch Changes

- @tisyn/ir@0.5.2
- @tisyn/kernel@0.5.2

## 0.5.1

### Patch Changes

- @tisyn/ir@0.5.1
- @tisyn/kernel@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0
  - @tisyn/kernel@0.5.0

## 0.4.0

### Minor Changes

- 0393e25: Add scoped effects support to the agent package.

  - Replace inlined `createApi` with `@effectionx/context-api@^0.5.3`, gaining `around(mw, { at: "min" | "max" })` priority API and live scope-walk inheritance via prototype chain traversal
  - Add `EnforcementContext` and `installEnforcement()` for non-bypassable cross-boundary enforcement wrappers (distinct from `EffectsContext` so child scopes cannot bypass parent restrictions)
  - Add `useAgent()` operation that returns a typed handle for an agent bound in the current scope via `useTransport()`; `Effects`, `useAgent()`, and `useTransport()` are designed to be used together inside a `scoped()` block
  - Add `evaluateMiddlewareFn()` to drive IR function nodes with scope-local dispatch semantics (only `dispatch` effects permitted; all others throw `ProhibitedEffectError`)

### Patch Changes

- Updated dependencies [0393e25]
  - @tisyn/kernel@0.4.0
  - @tisyn/ir@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0
  - @tisyn/kernel@0.3.0

## 0.2.0

### Minor Changes

- 5551c2d: Expose a public `Workflow<T>` type and tighten related declaration typing so authored
  workflows and generated workflow modules can share a stable public type surface.

### Patch Changes

- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
- Updated dependencies [3302f6a]
  - @tisyn/ir@0.2.0
  - @tisyn/kernel@0.2.0
