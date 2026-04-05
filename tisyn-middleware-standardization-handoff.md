# Middleware Standardization Handoff

Worktree: `/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/middleware-standardization`  
Branch: `docs/middleware-standardization`  
Base: current `main` after PRs #80 and #81

## Source Documents

Use these two files as the source material for the branch:

- `/Users/tarasmankovski/Downloads/middleware-standardization-amendment.md`
- `/Users/tarasmankovski/Downloads/middleware-test-plan.md`

Treat them as imported draft inputs, not as implementation-ready literal text. The handoff below narrows the work to what fits the current Tisyn codebase.

## What This Branch Should Do

Implement the middleware-standardization pass for the current scoped-effects and agent runtime model, then update the repo docs/specs/tests to match.

The main outcomes are:

1. `useAgent()` returns a derived per-agent facade with direct methods plus `.around()`.
2. The facade is backed by a Context API and composes structurally before `Effects`.
3. The separate `EnforcementContext` path is retired so behavioral constraints flow through ordinary middleware.
4. The scoped-effects spec and test-plan docs are updated to describe the real, current Tisyn model instead of the pre-standardization one.

## Critical Scoping Decision

Do **not** turn this branch into an agent invocation signature redesign.

The imported amendment and test plan assume array-of-arguments agent dispatch and multi-arg / zero-arg facade operations. The current repo does not work that way:

- `OperationSpec<Args, Result>` is single-payload.
- `agent().op(args)` produces `{ effectId, data: args }`.
- `invoke()` forwards one `data` payload.
- transport protocol execution currently carries `args: [data]` as an adapter shape, not as a user-facing variadic operation model.

So for this branch:

- keep the current single-payload operation contract,
- keep effect IDs in the existing `${agentId}.${operation}` format,
- adapt the imported amendment/test-plan text to current Tisyn payload semantics,
- do **not** add multi-arg or zero-arg facade APIs,
- do **not** change compiler lowering or protocol argument shape beyond what is needed to remove the special enforcement path.

If you want variadic agent operations later, that is a separate feature.

## In Scope

### 1. `@tisyn/agent` facade standardization

Update `packages/agent` so `useAgent()` returns a facade backed by a Context API instead of a plain generated handle.

Required behavior:

- the returned value still exposes one direct top-level method per declared operation,
- it also exposes `.around()` from the backing Context API,
- the backing API core handler delegates to `dispatch(`${agentId}.${opName}`, args as Val)` using the current single-payload contract,
- facade middleware composes before `Effects` middleware,
- multiple `useAgent(Agent)` calls in the same scope share middleware visibility for that agent,
- child-scope facade middleware is inherited by children and does not affect the parent after scope exit.

Implementation notes:

- `packages/agent/src/use-agent.ts` is the main implementation site,
- add a scope-local cache keyed by agent ID so separate facade references in the same scope share the same backing API / middleware visibility,
- keep object identity an implementation detail; semantic sharing matters, not `===`,
- update the exported types in `packages/agent/src/types.ts` and `packages/agent/src/index.ts` so the public type reflects `.around()`.

If introducing a helper file makes the implementation clearer, keep it inside `packages/agent/src/`.

### 2. Retire the separate enforcement path

The imported amendment’s R5/A7 is a real implementation change for this repo.

Current mismatch:

- `packages/agent/src/dispatch.ts` still has `EnforcementContext` and `installEnforcement()`,
- `dispatch()` still runs a privileged pre-Effects wrapper,
- `packages/transport/src/protocol-server.ts` installs cross-boundary constraints through that separate enforcement path.

Change this so behavioral constraints are ordinary middleware:

- remove `EnforcementContext`,
- remove `installEnforcement`,
- remove the enforcement branch from `dispatch()`,
- stop documenting/exporting enforcement as public API,
- in `packages/transport/src/protocol-server.ts`, when protocol middleware IR is present, install it as ordinary `Effects.around(...)` middleware in the scoped execution root before calling `impl.call(...)`,
- keep `installCrossBoundaryMiddleware()` only for propagation of the validated IR middleware to further child executions when that is still needed.

This branch does **not** need to make cross-boundary middleware non-shadowable anymore. The amendment explicitly prefers one ordinary middleware mechanism over a privileged path.

### 3. Spec and README updates

Update the canonical repo docs, not just package code.

Required doc work:

- amend `specs/tisyn-scoped-effects-specification.md` to standardize:
  - `Effects` as the universal dispatch Context API,
  - max/min ordering as API-local with Effects-vs-facade placement clarified,
  - `useAgent()` returning a derived facade backed by a Context API,
  - facade/Effects composition order and middleware visibility,
  - removal of the “separate enforcement channel” model in favor of ordinary root-scope middleware,
- add a repo test-plan document derived from the imported draft, but normalized to the current single-payload agent model,
- update `packages/agent/README.md` to describe the facade shape and remove references to `installEnforcement`,
- update any nearby docs/changelog text that still present `useAgent()` as returning a plain handle with no per-agent middleware surface.

Do **not** merge the imported draft text into canonical docs verbatim if it conflicts with current payload semantics. Normalize it first.

### 4. Test coverage

Add or rewrite tests so the branch proves the new semantics.

Minimum coverage:

- facade shape:
  - direct methods still exist,
  - `.around()` exists,
  - returned facade is not exposed as a raw `.operations` API,
- facade-to-Effects composition:
  - facade middleware runs before Effects middleware,
  - facade min still runs before Effects max,
  - Effects middleware still intercepts all agents,
- middleware visibility:
  - two `useAgent()` calls for the same agent in one scope share middleware visibility,
  - child facade middleware does not affect parent after scope exit,
- one-mechanism behavior:
  - deny/constraint middleware installed through ordinary `Effects.around()` in the execution root works,
  - no separate enforcement API remains,
- replay transparency:
  - workflow-facing middleware still executes during replay with no standardized replay-phase API surface.

Likely files to touch:

- `packages/agent/src/middleware-composition.test.ts`
- `packages/agent/src/scope-boundary.test.ts`
- `packages/agent/src/parent-non-bypassability.test.ts` (rewrite or replace; the old non-bypassability premise should no longer be canonical)
- `packages/runtime/...` tests for replay-facing assertions where needed
- `packages/transport/src/scope-isolation.test.ts`
- `packages/transport/src/cross-boundary-middleware.test.ts`

## Imported Test Plan Normalization

Before implementing from the imported test plan, normalize these mismatches:

1. Replace array-of-arguments facade dispatch assertions with current single-payload assertions.
   Example: the backing API core handler should dispatch the current payload object/value, not a synthetic variadic tuple API.

2. Drop multi-arg and zero-arg facade API cases unless you first redesign `OperationSpec`, `agent()`, `invoke()`, transport protocol payload handling, and compiler expectations in a separate branch.

3. Keep the facade `.around()` shape and middleware ordering model from the imported plan. That part aligns well with the current codebase.

4. Keep A6 implementation-side uniform boundary deferred. The imported test plan already treats it as deferred; preserve that boundary.

## Out of Scope

Do not broaden this branch into:

- a new authored/compiler syntax for `yield* reviewer.around(...)` in workflows,
- middleware helper factories (`guard`, `resolver`, etc.),
- a full transport/runtime boundary redesign for Effects `min`,
- a variadic agent operation model,
- replay-phase APIs exposed to workflow middleware,
- a general spec-process governance sweep across unrelated docs.

If you want to keep the imported amendment’s A4/A5 process/glossary ideas, do that as a separate doc follow-up after the implementation branch settles.

## Suggested File Targets

- `packages/agent/src/use-agent.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/index.ts`
- `packages/agent/src/dispatch.ts`
- `packages/transport/src/protocol-server.ts`
- `packages/agent/README.md`
- `specs/tisyn-scoped-effects-specification.md`
- `specs/tisyn-middleware-standardization-test-plan.md` (repo-native, normalized version)

If you keep a durable amendment doc in-repo, make it a repo-native adapted version, not a blind copy of the imported draft.

## Verification

Run the focused package tests that exercise the changed semantics:

```sh
pnpm --filter @tisyn/agent test
pnpm --filter @tisyn/runtime test
pnpm --filter @tisyn/transport test
```

If the spec/test-plan changes also touch conformance-facing expectations, run:

```sh
pnpm --filter @tisyn/conformance test
```

## Expected Deliverables

A good implementation branch should end with:

- the imported draft docs preserved as source references for the worktree,
- a repo-native handoff-compatible implementation of facade middleware and single-mechanism constraints,
- updated scoped-effects spec text,
- updated `@tisyn/agent` docs,
- tests proving facade ordering, visibility, scope inheritance, and enforcement-path removal,
- no lingering public documentation for `installEnforcement`.
