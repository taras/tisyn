# @tisyn/runtime

## 0.5.0

### Minor Changes

- e71915d: Add `orchestrateScope` for blocking scope execution.

  - New `orchestrateScope` runs a scope's body inside Effection's `scoped()`, providing lifecycle-bounded transport connections, enforcement middleware, and `BoundAgentsContext` registration
  - For each `bindings` entry, calls `installAgentTransport(prefix, factory)` — identical teardown semantics to authored `useTransport()` placed inside a `scoped()` block
  - If a `handler` FnNode is present, installs it via `installEnforcement` so all dispatch inside the body flows through the compiled middleware
  - Unified `childSpawnCount` counter covers `all`, `race`, and `scope` children for replay-safe IDs (e.g. sequential scopes under `root` get `root.0`, `root.1`; a scope after `All([a,b])` gets `root.2`)
  - Scope errors are routed through `kernel.throw()` so the parent workflow's `try/catch` can intercept them (T14)

- 9786a15: Orchestrate `spawn` and `join` compound-external operations in the runtime.

  - Spawn creates a background Effection task with `withResolvers` for join waiting
  - Join validates task handle shape, checks double-join, and waits for child completion
  - `scoped()` wrapper binds spawned children to the parent's lifetime — torn down when parent exits
  - Child failure propagates via Effection structured concurrency

### Patch Changes

- d4a051a: Evaluate scope binding expressions at scope-entry time.

  - Add `ScopeBindingEffectError`: thrown when a binding expression yields an effect (binding expressions must be pure)
  - Add `evaluateScopeBinding()`: drives a binding expression synchronously via the kernel evaluator; throws `ScopeBindingEffectError` if any effect is yielded
  - Replace `lookup(ref.name, env)` with `evaluateScopeBinding(binding, env)` in `orchestrateScope` so that any IR expression (not just `RefNode`) can be used as a factory binding
  - Wrap binding evaluation errors as `EffectError` before re-throwing so that parent IR-level `Try` nodes can catch scope-entry failures

- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [9786a15]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
- Updated dependencies [d4a051a]
  - @tisyn/ir@0.5.0
  - @tisyn/kernel@0.5.0
  - @tisyn/transport@0.5.0
  - @tisyn/validate@0.5.0
  - @tisyn/agent@0.5.0
  - @tisyn/durable-streams@0.5.0

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
