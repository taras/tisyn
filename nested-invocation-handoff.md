# Nested Invocation Handoff

You are working in:

`/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/nested-invocation-handoff`

Branch:

`nested-invocation-handoff`

Base commit:

`ca3f03f`

## Source Docs

Read these first:

- `tisyn-nested-invocation-specification.md`
- `tisyn-nested-invocation-test-plan.md`

Treat those two documents as the source of truth for scope and conformance. This handoff narrows them to the current repo and flags the places where the existing implementation shape does not yet match the spec surface.

The main prep has already been done:

- `main` was fetched and pulled before creating this worktree.
- The branch was created from pulled `main` at `ca3f03f`.
- The two source docs were imported from `/Users/tarasmankovski/Downloads`.

## Goal

Land the first repo pass of local nested invocation:

1. runtime-controlled `ctx.invoke(fn, args, opts?)` on the dispatch-boundary middleware surface
2. child execution as an ordinary journaled child coroutine using the parent's existing unified allocator
3. replay, error, and cancellation behavior aligned with the imported spec and test plan

The intended outcome is a real runtime feature with tests, not just imported docs.

## Current Repo Facts

- `packages/runtime/src/execute.ts` already owns the unified `childSpawnCount` allocator inside `driveKernel()`. Today it covers `scope`, `spawn`, `resource`, `timebox`, `all`, and `race`.
- `driveKernel()` already owns the replay cursor model, `YieldEvent`/`CloseEvent` writes, divergence checks, and structured cancellation. Reuse that machinery instead of introducing a second child runner.
- The closest allocator and child-lifecycle precedents are:
  - `spawn` for `+1` child allocation and inherited middleware/transport behavior
  - `resource` for "run child and await its result" orchestration without a parent-side yield event
  - `timebox` for mixed-origin allocator accounting where a construct consumes more than one child slot
- `packages/agent/src/dispatch.ts` owns the `Effects` context API. The current middleware surface is still `*dispatch([effectId, data], next)`; there is no visible `ctx.invoke` capability there yet.
- `packages/agent/src/facade.ts` builds per-agent `.around()` middleware on the same `createApi()` model. It likewise has no visible dispatch-boundary context object today.
- `packages/runtime/src/runtime-api.ts` shows the current repo pattern for middleware-capable runtime APIs built with `createApi()`, but nested invocation is not specified as a separate workflow API like `Runtime.loadModule()`. It belongs on the dispatch boundary.
- `packages/compiler/src/emit.ts` currently hardcodes authored `Effects.around({ *dispatch([id, data], next) { ... } })` handling. The imported nested-invocation spec says the compiler is unmodified, so do not make this feature depend on new authored syntax.
- There is no existing named `ScopedEffectOverlay` type or nested invocation helper in the repo. If you need a public type, add the narrowest honest surface where the middleware API lands.
- The imported spec explicitly says agent operation handlers must not call `ctx.invoke`. The repo currently has no guard for that because the API does not exist yet.

## First Implementation Problem

Resolve the middleware API seam before writing much runtime code.

The imported spec requires `ctx.invoke(...)` from dispatch-boundary middleware, but the current repo exposes middleware as `(args, next)` only. Start by deciding how to surface an invocation context without breaking:

- existing `Effects.around()` call sites
- existing facade `.around()` call sites
- the imported requirement that the compiler remains unchanged for MVP

Do not assume the required context object already exists somewhere hidden in the stack. It does not in the current repo surface.

## Likely Code Areas

- `packages/agent/src/dispatch.ts`
- `packages/agent/src/facade.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/README.md`
- `packages/runtime/src/execute.ts`
- `packages/runtime/src/spawn.test.ts`
- `packages/runtime/src/resource.test.ts`
- `packages/runtime/src/timebox.test.ts`
- `packages/runtime/src/replay.test.ts`
- `packages/runtime/src/recovery.test.ts`
- `packages/runtime/src/cancellation.test.ts`
- `packages/runtime/src/runtime-api.test.ts`
- `specs/tisyn-scoped-effects-specification.md`
- `specs/tisyn-compound-concurrency-specification.md`

If the feature needs its own focused runtime tests, add a dedicated file such as `packages/runtime/src/nested-invocation.test.ts` rather than overloading unrelated suites.

## Implementation Defaults

### 1. Keep this runtime- and middleware-only

Do not add:

- a new kernel descriptor
- any kernel classification change
- any compiler-visible `invoke(...)` syntax
- any new durable event kind

The imported spec is explicit that kernel and compiler stay unchanged for MVP.

### 2. Reuse the parent-owned allocator exactly

Nested invocation must consume the same `childSpawnCount` space already used by `scope`, `spawn`, `resource`, `all`, `race`, and `timebox`.

Do not add:

- a namespaced allocator
- `.n` child IDs
- a separate counter for middleware-origin children

### 3. Drive invoked children through ordinary runtime machinery

Run invoked children through the same `driveKernel()` path used everywhere else so replay, journal writes, close behavior, and cancellation stay uniform.

The parent must not journal an event for `ctx.invoke` itself. Only the child journals under its own coroutineId.

### 4. Treat invalid call sites as runtime errors with no allocation

If `ctx.invoke` is attempted outside active dispatch-boundary middleware, or from non-replay-transparent code such as an agent operation handler, fail without advancing the allocator.

### 5. Keep overlay ownership runtime-side

If you implement `opts.overlay`, the push/pop bracket should be owned by the runtime and should not leak outside the invoked child subtree. The overlay itself is not a new journaled input category.

### 6. Preserve existing middleware ergonomics where possible

If the middleware API shape must widen to expose `ctx.invoke`, preserve existing `(args, next)` behavior for current callers instead of forcing a repo-wide rewrite.

## Suggested First Pass

1. Add a minimal failing runtime test for the basic journal shape and no-parent-event rule.
2. Add a second failing test for replay without re-dispatch.
3. Introduce the smallest dispatch-boundary context plumbing that can expose `ctx.invoke` to middleware while preserving existing middleware call sites.
4. Implement nested child allocation and execution in `packages/runtime/src/execute.ts` by reusing existing child-runner patterns rather than branching off a separate journal path.
5. Add mixed-origin allocator tests against `all(...)` and `timebox(...)`.
6. Add invalid-call-site and cancellation tests.
7. Only after behavior is stable, update the synchronized scoped-effects and compound-concurrency spec paragraphs called out by the imported spec.

## Verification

Run the narrowest relevant package tests first:

```bash
pnpm --filter @tisyn/runtime test
pnpm --filter @tisyn/agent test
```

If you add or update spec markdown in `specs/`, run any spec-specific checks that already exist in the repo after runtime and agent tests pass.

## Do Not Do

- Do not move the imported docs into `specs/` before the implementation settles.
- Do not invent an authored workflow `invoke(...)` syntax for this MVP.
- Do not add a new kernel external or a fake parent-side invoke event.
- Do not split nested invocation onto a separate child-ID namespace.
- Do not quietly broaden the feature to concurrent `ctx.invoke` composition, subordinate remote execution, or detached lifetime. Those are explicitly out of scope in the imported docs.
- Do not edit `.reviewer/AGENTS.md` for this active work. Keep handoff and active notes in this worktree.
