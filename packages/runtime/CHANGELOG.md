# @tisyn/runtime

## 0.4.0

### Minor Changes

- 0393e25: Add scoped-effects runtime wiring to `execute()`.

  - `execute()` now routes effects through the scope-local `Effects` middleware chain (enforcement wrappers, transport middleware) by calling `dispatch()` from `@tisyn/agent`

### Patch Changes

- Updated dependencies [0393e25]
- Updated dependencies [0393e25]
  - @tisyn/agent@0.4.0
  - @tisyn/kernel@0.4.0
  - @tisyn/durable-streams@0.4.0
  - @tisyn/ir@0.4.0
  - @tisyn/validate@0.4.0

## 0.3.0

### Minor Changes

- 4375b0a: Re-export `EffectError` from the package entry point so consumers can `import { EffectError } from "@tisyn/runtime"` directly. Add integration tests for try/catch/finally at the runtime level, including the `finallyPayload` binding contract and the inner-Try fallback for uncaught-error paths.

### Patch Changes

- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0
  - @tisyn/kernel@0.3.0
  - @tisyn/validate@0.3.0
  - @tisyn/agent@0.3.0
  - @tisyn/durable-streams@0.3.0

## 0.2.0

### Patch Changes

- 5551c2d: Include execution compatibility updates from the Effection 4.0.2 downgrade and related
  runtime cleanup.
- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
- Updated dependencies [5551c2d]
- Updated dependencies [3302f6a]
- Updated dependencies [3302f6a]
  - @tisyn/ir@0.2.0
  - @tisyn/agent@0.2.0
  - @tisyn/validate@0.2.0
  - @tisyn/kernel@0.2.0
  - @tisyn/durable-streams@0.2.0
