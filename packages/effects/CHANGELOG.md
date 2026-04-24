# @tisyn/effects

## 0.3.0

### Minor Changes

- 0f255bf: Adds `invokeInline(fn, args, opts?)` as a public helper alongside
  `invoke`. Dispatch-boundary middleware can now evaluate a compiled
  `Fn` as an inline lane whose effects journal under a distinct
  coroutineId for deterministic replay but share the caller's
  Effection lifetime — no `CloseEvent` and no new scope boundary.
  Return values and errors from the inline body propagate directly
  to the caller's middleware frame (no reification, unlike `invoke`).

  Call-site rules mirror `invoke`: `invokeInline` MUST be called
  from inside a dispatch middleware body currently handling a
  dispatched effect. Calls from agent handlers, `resolve`
  middleware, facade `.around(...)` middleware, IR middleware, or
  code outside any middleware throw `InvalidInvokeCallSiteError`
  naming `invokeInline`. Invalid inputs (non-`Fn` `fn`, non-array
  `args`, invalid `opts`) throw `InvalidInvokeInputError` /
  `InvalidInvokeOptionError` without advancing the parent's
  `childSpawnCount` allocator.

  Non-breaking: no change to existing `invoke` behavior. The
  `@tisyn/effects/internal` workspace seam gains a corresponding
  required `invokeInline` method on `DispatchContext`; the runtime
  (`@tisyn/runtime`) provides the implementation.

  Semantics per `tisyn-inline-invocation-specification.md`.

- 2037b6b: **BREAKING (pre-1.0):** The `Effects` dispatch API now composes
  through three middleware lanes instead of two. Public
  `Effects.around({ at })` continues to accept only `"max"` and
  `"min"`; an internal `replay` lane sits between them and is
  reserved for the runtime's replay-substitution boundary. Passing
  any other `{ at }` value through the public API — including
  `{ at: "replay" as any }` via an unsafe cast — is rejected at
  runtime with an error that does not name the internal lane.

  A non-stable `installReplayDispatch` is exported on
  `@tisyn/effects/internal` for workspace-internal consumers
  (`@tisyn/runtime`) to install middleware into the replay lane
  without exposing the lane name through any public surface.
  `@tisyn/effects/internal` remains a non-stable workspace seam and
  is NOT part of the package's compatibility contract.

  No change to existing user-facing `Effects.around` / `dispatch` /
  agent-binding behavior. Middleware installed at `{ at: "max" }`
  still runs outermost and middleware at `{ at: "min" }` still runs
  innermost, with the same append/prepend ordering. The change is
  purely structural — it enables `@tisyn/runtime` to install a
  replay-substitution frame between the max and min regions without
  requiring user middleware to know that the lane exists.

  This entry covers the substrate that shipped in PR #128 without
  an accompanying changeset; the matching runtime behavior change
  is in the paired `@tisyn/runtime` release.

### Patch Changes

- c268fc0: Update the `invokeInline` public JSDoc to document the new
  runtime support: `resource` inside an inline body now provides
  in the caller's scope and cleans up at caller teardown (§11.4,
  §11.8). The public signature is unchanged.

  The doc also notes the remaining rejections — the six
  non-resource compound externals (`scope`, `spawn`, `join`,
  `timebox`, `all`, `race`), and `resource` inside an inline
  body invoked from a resource-init or resource-cleanup dispatch
  context (nested resources inside a resource body remain
  unsupported).

  Paired with the runtime-side implementation.

- 969d91f: Update the `invokeInline` public JSDoc to document the new
  runtime support: `spawn` and `join` inside an inline body
  now attach to the hosting caller's Effection scope and
  share the hosting site's existing durable task table per
  §11.5, so sibling/caller code can resolve task handles
  acquired inside an inline body using the existing
  double-join semantics. The public signature is unchanged.

  Paired with the runtime-side implementation.

- ad2e267: Extend the internal `DispatchContext` seam with
  `readonly ownerCoroutineId: string` so the runtime can
  propagate capability-ownership identity through the
  dispatch chain (inline lanes inherit the caller's owner;
  `invoke` children reset to the child's own coroutineId).

  `DispatchContext` is exported only from
  `@tisyn/effects/internal` and has no stable-surface
  contract; external consumers only interact with it via
  `DispatchContext.with(undefined, ...)` to isolate agent
  bodies, which is unchanged. The `invokeInline` public
  helper signature is unchanged.

  Paired with the runtime-side implementation that lifts
  `stream.subscribe` / `stream.next` rejection inside
  `invokeInline` bodies. See
  `tisyn-inline-invocation-specification.md` §12.

- dde36c6: Update the `invokeInline` public JSDoc to document the new
  runtime support: `timebox`, `all`, and `race` now work
  inside inline bodies with their own compound-external
  semantics per §11.6. `scope` is the only compound still
  rejected; a follow-up phase will review its
  transport-binding semantics before lifting it.

  Paired with the runtime-side implementation. Public
  signature unchanged.

- 29707e6: Swap the preview `@effectionx/context-api` dependency (pinned
  to a pkg.pr.new URL) for the in-repo workspace vendor
  `@tisyn/context-api`. Removes the install-time patch
  workaround (`scripts/patch-context-api-preview.mjs`) that
  stripped the `development` export condition from the
  preview package. No behavior change in public
  `@tisyn/effects` API or observable middleware-composition /
  replay-lane semantics.
- Updated dependencies [29707e6]
  - @tisyn/context-api@0.15.0
  - @tisyn/ir@0.15.0
  - @tisyn/kernel@0.15.0

## 0.2.0

### Minor Changes

- c792d86: Introduce `@tisyn/effects`, the dispatch-boundary package for Tisyn. Authors
  of effectful workflows and transports import `Effects`, `dispatch`, `resolve`,
  `invoke`, `InvalidInvokeCallSiteError`, `InvalidInvokeInputError`,
  `InvalidInvokeOptionError`, `installCrossBoundaryMiddleware`, and
  `getCrossBoundaryMiddleware` from here instead of `@tisyn/agent`. The package
  also exposes a non-stable `@tisyn/effects/internal` subpath that workspace
  packages (`agent`, `runtime`, `transport`) use for the shared
  `DispatchContext` seam and `evaluateMiddlewareFn`; user code must not depend
  on `@tisyn/effects/internal`.

### Patch Changes

- @tisyn/ir@0.14.0
- @tisyn/kernel@0.14.0
