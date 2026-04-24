# @tisyn/runtime

## 0.15.0

### Minor Changes

- 0f255bf: Adds the runtime implementation for `invokeInline` as a core
  slice against `tisyn-inline-invocation-specification.md` v6.
  Dispatch-boundary middleware that calls
  `invokeInline(fn, args, opts?)` now runs a compiled `Fn` as a
  journaled inline lane under the caller's Effection scope:

  - **Lane identity** — each accepted call allocates one lane id
    from the caller's unified `childSpawnCount` (shared with
    `invoke`, `spawn`, `resource`, `scope`, `timebox`, `all`,
    `race`). Rejected calls (invalid call site, non-`Fn` `fn`,
    non-array `args`, invalid `opts`) do not advance the
    allocator.
  - **Journal shape** — standard-effect dispatches in the inline
    body journal under the lane coroutineId via the shared replay-
    aware dispatch helper. The lane itself produces no
    `CloseEvent` under any condition (normal completion, uncaught
    error, cancellation). No event is written for the
    `invokeInline` call itself on the caller's coroutineId.
  - **Return and error propagation** — the inline body's kernel
    value is returned directly from the `Operation<T>`; uncaught
    errors propagate directly (no reification, unlike `invoke`).
  - **Replay** — lane and caller cursors are independent; replay
    reconstructs both by deterministic re-execution of the same
    `invokeInline` sequence. Live and replay journals are
    byte-identical for the IL-R-001 subset.
  - **Nested inline** — `invokeInline` called from middleware
    handling an effect dispatched during an outer inline body
    allocates a child lane with the `parentLane.{m}` format. Each
    lane in a nested subtree has its own independent allocator
    and cursor; no `CloseEvent` is produced at any level.
  - **`invoke` inside inline** — retains full nested-invocation
    semantics: own scope, own `CloseEvent`, reified child result.

  **Phase 5B scope limit.** The `driveInlineBody` helper
  explicitly rejects, with a clear error, any descriptor it
  cannot yet support safely:

  - Every compound external (`scope`, `spawn`, `join`,
    `resource`, `timebox`, `all`, `race`) inside an inline body.
  - `stream.subscribe` and `stream.next` inside an inline body —
    v6 §12.4 requires owner-coroutineId counter allocation for
    deterministic tokens; shipping a lane-local approximation
    would violate the landed spec. A follow-up phase will add
    owner-counter handling and lift the rejection.

  Ordinary agent effects and `__config` dispatches inside an
  inline body work normally.

  Non-breaking: no existing `invoke`, agent, transport, or runtime
  behavior changes. Existing replay/recovery/nested-invocation
  test suites remain green. The spec's IL-INT-_, IL-RD-_,
  IL-EX-\*, and the full 31-test minimum acceptance subset are
  future work.

  Semantics per `tisyn-inline-invocation-specification.md`.

- 2037b6b: **BREAKING (pre-1.0):** Workflow replay is now structural. User
  middleware installed via `Effects.around` re-executes on replay,
  seeing the stored result returned from `next()`; framework
  handlers (`Agents.use`, `implementAgent(...).install`,
  `installAgentTransport`, `installRemoteAgent`) and core dispatch
  do NOT re-execute when the journal already records a result for
  that dispatch. Short-circuiting max frames yield to the stored
  cursor at chain exit — the stored result wins over the
  short-circuit value.

  Resource init and resource cleanup dispatches traverse the same
  replay-boundary-aware chain as ordinary coroutine dispatch.
  Middleware around a resource-body dispatch now receives a
  `DispatchContext` with `ctx.invoke` capability using the resource
  child's allocator. The resource body's authored surface is
  unchanged; only the middleware's observable surface expands.

  Callers that were relying on the previous pre-dispatch replay
  short-circuit — where `Effects.around` middleware did not re-run
  on replay — will observe their middleware bodies running again on
  replay. Middleware that should execute on every dispatch
  (including replay) is already in the right position at
  `{ at: "max" }` (the default) and no migration is required.
  Middleware that should NOT re-run on replay can move to
  `{ at: "min" }`, which places it below the replay-substitution
  boundary and preserves the previous behavior.

  The companion `@tisyn/effects` release provides the internal
  three-lane composition substrate this behavior change uses.

### Patch Changes

- 43e8c48: Lift the Phase 5B rejection of `resource` inside `invokeInline`
  bodies by completing the spec's §11.4 / §11.8 contract.

  - **Provide in caller scope, cleanup at caller teardown.** A
    resource acquired inside an inline body now registers with
    the caller's resource list (the same list that holds the
    caller's ordinary resources), so reverse-order teardown runs
    as a single caller-level sequence. Sibling inline lanes and
    post-return caller code can reuse the resource until the
    caller exits. The resource child still produces its own
    `CloseEvent` under `laneId.{m}`; the inline lane itself
    still produces no `CloseEvent`.
  - **Allocator discipline preserved.** The resource child id is
    allocated from the inline lane's own `inlineChildSpawnCount`;
    a rejected call does not advance the lane's allocator.
  - **Nested resources still unsupported.** `invokeInline` called
    from a resource-init or resource-cleanup dispatch context
    continues to reject an inline-body `resource` yield with a
    clear error — preserving the existing "Nested resource is
    not supported" rule. `invokeInline` itself remains usable
    from those contexts for non-resource effects.
  - **Other compound externals still rejected.** `scope`,
    `spawn`, `join`, `timebox`, `all`, `race` inside inline
    bodies remain rejected with a clear error naming the
    descriptor id; those remain follow-up phases.

  No kernel/compiler/IR/durable-event-algebra changes. No new
  public API. Semantics per
  `tisyn-inline-invocation-specification.md` §11.

- 969d91f: Lift the Phase 5B rejection of `spawn` and `join` inside
  `invokeInline` bodies per the inline-invocation spec's §11.5.

  Step middleware can now start background child work from
  inside shared-lifetime inline execution and have the
  returned task handle be joinable from the inline body
  itself, sibling inline lanes, or later caller code —
  without creating an inline scope boundary.

  The implementation shares the hosting dispatch site's
  existing durable task table (the pair of `spawnedTasks` +
  `joinedTasks` maps already maintained by `driveKernel` and
  `orchestrateResourceChild` for ordinary-yield spawn/join)
  with inline evaluation. No new inline-specific bookkeeping
  system is introduced.

  - **Spawn.** Inside an inline body, `spawn` allocates the
    child id from the lane's own `inlineChildSpawnCount` in
    `laneId.{m}` format and starts the child via
    `driveKernel(childKernel, childId, childEnv, ctx)`. The
    child task runs under the hosting caller's Effection scope
    — spawned via `yield* spawn(...)` inside the ambient
    middleware chain — and produces its normal `CloseEvent`
    under `laneId.{m}`. The inline lane itself still produces
    no `CloseEvent`.
  - **Join.** Handles resolve against the hosting caller's
    `spawnedTasks` map; the double-join set is also shared, so
    the existing "already been joined" error fires whether
    both joins are from the inline body, from siblings, or
    across the caller boundary.
  - **Resource-body hosts unchanged.** When a resource init or
    cleanup body hosts the dispatch, inline-body spawn/join
    attaches to THAT phase's durable task table — mirroring
    where ordinary-yield `spawn` from inside the resource body
    already lands.

  `scope`, `timebox`, `all`, `race` inside inline bodies
  remain rejected with a clear error. Nested resources inside
  a resource body (from an inline-body `resource` yield in a
  resource-init/cleanup context) remain rejected per Phase 5D.
  No kernel/compiler/IR/durable-event-algebra changes; no
  public API changes; `invokeInline` signature unchanged.

- 33c6391: Lift the Phase 5B rejection of `stream.subscribe` and
  `stream.next` inside `invokeInline` bodies by implementing the
  owner-coroutineId counter model from
  `tisyn-inline-invocation-specification.md` §12.

  - **Shared subscription counter across inline siblings and
    caller.** Subscription tokens are now allocated from a
    counter keyed by the dispatch chain's **owner coroutineId** —
    the original caller's coroutineId, captured once at the
    outermost `invokeInline` and inherited unchanged through
    nested inline calls. Sibling inline lanes and the caller
    itself share a single token namespace, so a handle acquired
    inside an inline body can be used by another sibling inline
    lane or by the caller after the inline returns, without
    spurious `SubscriptionCapabilityError` ancestry failures or
    token collisions.
  - **`invoke` children keep their own namespace.** Per §12.8,
    an `invoke` child is its own owner: tokens allocated inside
    the child are prefixed with the child's coroutineId, and the
    caller cannot use handles that escape an `invoke` child
    (ancestry check correctly fails).
  - **`stream.next` ancestry check compares owner identity**
    (not journal coroutineId). For ordinary dispatch where owner
    equals coroutineId, behavior is byte-identical to the prior
    release — no fixture changes in the stream-iteration or
    replay-dispatch suites.
  - **Journal shape unchanged.** Stream YieldEvents continue to
    journal under the inline lane's coroutineId; owner identity
    lives only in runtime context and inside the opaque
    subscription-handle token string (which already encoded a
    coroutineId in the prior format). No new durable event
    kinds, no `ownerCoroutineId` field on `YieldEvent`, no
    kernel/compiler/IR changes.

  Compound externals inside inline bodies (`scope`, `spawn`,
  `join`, `resource`, `timebox`, `all`, `race`) remain rejected
  with a clear error — lifting those is a follow-up phase.

  Non-breaking for existing workloads: ordinary dispatch and
  `invoke`-child subscription tokens keep their
  `sub:<coroutineId>:<n>` shape. Semantics per
  `tisyn-inline-invocation-specification.md` §12.

- dde36c6: Lift the `timebox`, `all`, and `race` rejections inside
  `invokeInline` bodies per §11.6 of the inline-invocation
  specification. Step middleware can now use bounded and
  concurrent child work inside shared-lifetime inline
  execution without introducing a scope boundary.

  - **`timebox` inside an inline body.** Allocates two child
    IDs from the inline lane's own counter —
    `laneId.{N}` (body) and `laneId.{N+1}` (timeout) — and
    delegates to the existing `orchestrateTimebox` helper.
    The orchestrator resolves with the tagged value
    `{ status: "completed", value }` on body-win and
    `{ status: "timeout" }` on timeout-win (timeout is NOT
    an error; it is a successful tagged value). Both the
    body child and the timeout child emit their own
    `CloseEvent`; the inline lane itself still emits none.
  - **`all` and `race` inside an inline body.** Allocate
    `exprs.length` contiguous child IDs from the inline
    lane's own counter and delegate to the existing
    `orchestrateAll` / `orchestrateRace` helpers. Result
    ordering, first-winner propagation, and empty-list
    handling all match the runtime's pre-existing semantics.
  - **Error routing.** Orchestrator errors (e.g. fail-fast
    propagation from `all`) are routed through
    `kernel.throw(err)` with the three-outcome pattern, so
    the inline body's own `try`/`catch` semantics work for
    these compounds the same way they do for standard-effect
    errors.
  - **`provide` misuse framing.** An inline body yielding a
    bare `provide` outside a resource context throws
    `RuntimeBugError("provide outside resource context")` —
    framed as caller IR misuse (matching driveKernel), not
    as a "deferred inline compound".

  `scope` inside an inline body remains rejected with a
  clear error naming only it; its transport-binding
  semantics (handler / bindings / scope boundary) need their
  own review before lifting. The catch-all rejection message
  is narrowed to the single-compound form.

  No kernel / compiler / IR / durable-event-algebra changes;
  no public API changes; `invokeInline` signature unchanged.

- 29707e6: Swap the preview `@effectionx/context-api` dependency for
  the in-repo workspace vendor `@tisyn/context-api`. No
  behavior change in public `@tisyn/runtime` API or
  observable Runtime-context / middleware-composition /
  replay semantics.
- Updated dependencies [e7d62c6]
- Updated dependencies [4766e26]
- Updated dependencies [29707e6]
- Updated dependencies [29707e6]
- Updated dependencies [c268fc0]
- Updated dependencies [969d91f]
- Updated dependencies [ad2e267]
- Updated dependencies [dde36c6]
- Updated dependencies [0f255bf]
- Updated dependencies [2037b6b]
- Updated dependencies [29707e6]
- Updated dependencies [e7d62c6]
- Updated dependencies [51d11f5]
- Updated dependencies [4766e26]
  - @tisyn/agent@0.15.0
  - @tisyn/context-api@0.15.0
  - @tisyn/effects@0.3.0
  - @tisyn/transport@0.15.0
  - @tisyn/ir@0.15.0
  - @tisyn/kernel@0.15.0
  - @tisyn/validate@0.15.0
  - @tisyn/durable-streams@0.15.0

## 0.14.0

### Minor Changes

- c792d86: `@tisyn/runtime` no longer declares its own `DispatchContext`. The dispatch
  boundary seam now has a single owner in `@tisyn/effects/internal`, eliminating
  the silent name-keyed coupling between the two previous declarations.
  `DispatchContext` is not and was not part of the runtime's public barrel;
  users who imported it from a deep path must switch to
  `@tisyn/effects/internal`, which is a workspace-intended subpath and is not
  covered by public stability guarantees. Runtime consumers that previously
  pulled `Effects`, `dispatch`, `resolve`, or `ScopedEffectFrame` through
  `@tisyn/agent` must now import them from `@tisyn/effects` — `@tisyn/agent`
  no longer exposes that surface.

### Patch Changes

- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
  - @tisyn/agent@0.14.0
  - @tisyn/effects@0.2.0
  - @tisyn/transport@0.14.0
  - @tisyn/ir@0.14.0
  - @tisyn/kernel@0.14.0
  - @tisyn/validate@0.14.0
  - @tisyn/durable-streams@0.14.0

## 0.13.0

### Minor Changes

- db46668: Host-side JS dispatch middleware can now invoke compiled Fns as journaled child coroutines via `invoke(fn, args, opts?)` (exported from `@tisyn/agent`). Child coroutineIds come from the parent's unified `childSpawnCount` allocator (`${parent}.${k}`, no namespace, no `.n`). Overlay frames pushed via `opts.overlay: { kind, id }` are visible only to the child subtree via `currentScopedEffectFrames()` and are not journaled. Abnormal child close — including cancelled — throws at the `yield* invoke(...)` await site in both live execution and replay; cancellation surfaces as `InvocationCancelledError`.

### Patch Changes

- Updated dependencies [db46668]
- Updated dependencies [a779cb7]
- Updated dependencies [12f992d]
  - @tisyn/agent@0.13.0
  - @tisyn/durable-streams@0.13.0
  - @tisyn/transport@0.13.0
  - @tisyn/ir@0.13.0
  - @tisyn/kernel@0.13.0
  - @tisyn/validate@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [34d48ce]
- Updated dependencies [9801960]
  - @tisyn/agent@0.12.0
  - @tisyn/transport@0.12.0
  - @tisyn/ir@0.12.0
  - @tisyn/kernel@0.12.0
  - @tisyn/validate@0.12.0
  - @tisyn/durable-streams@0.12.0

## 0.11.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [12c9cfa]
- Updated dependencies [37bbb63]
  - @tisyn/kernel@0.11.0
  - @tisyn/transport@0.11.0
  - @tisyn/agent@0.11.0
  - @tisyn/ir@0.11.0
  - @tisyn/durable-streams@0.11.0
  - @tisyn/validate@0.11.0

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
