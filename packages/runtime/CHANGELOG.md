# @tisyn/runtime

## 1.0.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [12c9cfa]
- Updated dependencies [37bbb63]
  - @tisyn/kernel@1.0.0
  - @tisyn/transport@1.0.0
  - @tisyn/agent@1.0.0
  - @tisyn/ir@1.0.0
  - @tisyn/durable-streams@1.0.0
  - @tisyn/validate@1.0.0

## 0.10.0

### Patch Changes

- ae8d61c: Enforce curly braces on all control flow statements.
- ae02508: Replace the separate enforcement path in `orchestrateScope()` with ordinary `Effects.around()` middleware. Cross-boundary middleware is now installed as the first max-priority `Effects.around()` before transport bindings so parent constraints remain outermost through normal scope inheritance. Runtime no longer mutates or depends on `BoundAgentsContext`.
- Updated dependencies [d918311]
- Updated dependencies [ae8d61c]
- Updated dependencies [ae02508]
- Updated dependencies [ae02508]
- Updated dependencies [7004d09]
  - @tisyn/transport@0.10.0
  - @tisyn/agent@0.10.0
  - @tisyn/config@0.10.1
  - @tisyn/ir@0.10.0
  - @tisyn/kernel@0.10.0
  - @tisyn/validate@0.10.0
  - @tisyn/durable-streams@0.10.0

## 0.9.0

### Minor Changes

- e6696fb: Resolve per-agent `config` through env resolution pipeline and expose on `ResolvedAgent`
- 8d82f9c: Add `Runtime` context API with `Runtime.loadModule(specifier, parentURL)` and `Runtime.around(...)` for middleware-interceptable module loading. Export shared default loader (`loadModule`, `isTypeScriptFile`) and error types (`ModuleLoadError`, `UnsupportedExtensionError`, `ModuleNotFoundError`, `LoaderInitError`).

### Patch Changes

- Updated dependencies [e6696fb]
- Updated dependencies [34533e6]
  - @tisyn/config@0.10.0
  - @tisyn/transport@0.9.0
  - @tisyn/agent@0.9.0
  - @tisyn/ir@0.9.0
  - @tisyn/kernel@0.9.0
  - @tisyn/validate@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.9.0

### Minor Changes

- 7ad2031: Support config-aware execution via `ExecuteOptions.config` and resolve `__config` as a journaled runtime effect for replay-safe workflow config access.
- 8eb99d9: Add `config` field to `ExecuteOptions` and handle `__config` as a journaled standard effect for config-aware workflow execution via `yield* useConfig()`.
- 6b2a66a: Add config resolution helpers — `applyOverlay` (entrypoint merge-by-id), `resolveEnv` (env variable resolution with type coercion), `resolveConfig` (full pipeline: overlay → validate → resolve → project), and `projectConfig` (strips descriptor metadata, produces runtime-ready shape).
- 38d9ffc: Add `orchestrateTimebox` with structured concurrency — body wins on simultaneous completion (TB-R6), deterministic child ID allocation.

### Patch Changes

- Updated dependencies [6b2a66a]
- Updated dependencies [7ad2031]
- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
  - @tisyn/config@0.9.0
  - @tisyn/ir@0.9.0
  - @tisyn/kernel@0.9.0
  - @tisyn/validate@0.9.0
  - @tisyn/transport@0.9.0
  - @tisyn/agent@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.8.0

### Minor Changes

- b515855: Handle `stream.subscribe` and `stream.next` standard external effects in the execution loop.

  - `stream.subscribe` creates an Effection subscription and returns a deterministic capability handle (`sub:{coroutineId}:{counter}`)
  - `stream.next` iterates the subscription, returning `{ done, value }` results
  - Stream-aware dispatch added to all three dispatch sites: main driveKernel, resource init, and resource cleanup
  - Capability enforcement: RV1 rejects cross-coroutine handle use, RV2 rejects handles in non-stream effect data, RV3 rejects handles in any coroutine close value
  - Replay caches source definitions during `stream.subscribe` replay; lazy subscription reconstruction at the live frontier

### Patch Changes

- Updated dependencies [b515855]
  - @tisyn/kernel@0.8.0
  - @tisyn/transport@0.8.0
  - @tisyn/agent@0.8.0
  - @tisyn/durable-streams@0.8.0
  - @tisyn/ir@0.8.0
  - @tisyn/validate@0.8.0

## 0.7.0

### Minor Changes

- f074970: Orchestrate `resource` and `provide` compound externals in the execution loop.

  - `orchestrateResourceChild` manages init → provide → background → teardown lifecycle
  - Parent blocks until child reaches `provide`, resumes with provided value
  - Resource children torn down in reverse creation order on parent exit (R21)
  - Child Close events precede parent Close events (R23)
  - Init failure propagates to parent (catchable via try/catch)
  - Cancellation writes exactly one `Close(cancelled)` per child via `ensure` handler
  - Provided value is not journaled — recomputed on replay

### Patch Changes

- Updated dependencies [f074970]
- Updated dependencies [f074970]
- Updated dependencies [f074970]
  - @tisyn/ir@0.7.0
  - @tisyn/kernel@0.7.0
  - @tisyn/validate@0.7.0
  - @tisyn/agent@0.7.0
  - @tisyn/transport@0.7.0
  - @tisyn/durable-streams@0.7.0

## 0.6.0

### Patch Changes

- e4dc3d9: Add tests for built-in sleep effect: compiled sleep succeeds, replay works, dispatch middleware intercepts, unknown effects still fail, `Effects.sleep(ms)` works directly.
- Updated dependencies [e4dc3d9]
- Updated dependencies [1f58703]
  - @tisyn/agent@0.6.0
  - @tisyn/kernel@0.6.0
  - @tisyn/transport@0.6.0
  - @tisyn/durable-streams@0.6.0
  - @tisyn/ir@0.6.0
  - @tisyn/validate@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [f47f4ca]
  - @tisyn/transport@0.5.2
  - @tisyn/agent@0.5.2
  - @tisyn/ir@0.5.2
  - @tisyn/kernel@0.5.2
  - @tisyn/validate@0.5.2
  - @tisyn/durable-streams@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [c35a0c9]
  - @tisyn/transport@0.5.1
  - @tisyn/agent@0.5.1
  - @tisyn/ir@0.5.1
  - @tisyn/kernel@0.5.1
  - @tisyn/validate@0.5.1
  - @tisyn/durable-streams@0.5.1

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
