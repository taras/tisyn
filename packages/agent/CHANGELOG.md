# @tisyn/agent

## 0.13.0

### Minor Changes

- db46668: Host-side JS dispatch middleware can invoke a compiled Fn as a journaled child coroutine via the new `invoke(fn, args, opts?)` helper from `@tisyn/agent`. Must be called from inside an active `Effects.around({ dispatch })` middleware body — agent handlers (reached through `impl.install()`, `Agents.use(...)`, or direct `impl.call(...)`), `resolve` middleware, and facade `.around(...)` middleware all throw `InvalidInvokeCallSiteError`. `opts` is `{ overlay?: { kind, id }, label?: string }`. Replay, cancellation, and abnormal-close propagation flow through the existing kernel machinery. No change to `Effects.around(middleware, options?)` or facade `.around(middleware, options?)` signatures. Compiler-authored middleware does not yet expose `invoke`; that path is deferred pending a spec amendment. The public `@tisyn/agent` surface is **only** `invoke` plus the error classes (`InvalidInvokeCallSiteError`, `InvalidInvokeInputError`, `InvalidInvokeOptionError`). The `DispatchContext` that `invoke` reads internally is a package-internal seam and is not exported from any public import path — `@tisyn/agent` publishes only the `.` subpath, so user code cannot install a synthetic ambient context to make `invoke(...)` succeed outside a live dispatch middleware. Workspace peers that need the same scope slot (e.g. `@tisyn/runtime`) declare a matching name-keyed Effection context locally.
- 12f992d: Removed the `invoke(invocation)` helper and the `Invocation` public type
  export. Call sites that previously wrote `yield* invoke(agent.op(args))`
  should now pass the call descriptor straight to `dispatch`, which accepts
  either a `(effectId, data)` pair or a `{ effectId, data }` object:

      const result = yield* dispatch(agent.op(args));

  The descriptor shape returned by `agent().op(args)` is unchanged; only the
  public `Invocation` type name and the `invoke` function are removed. The
  `invoke` name is freed for a future nested-invocation helper.

### Patch Changes

- @tisyn/ir@0.13.0
- @tisyn/kernel@0.13.0

## 0.12.0

### Minor Changes

- 34d48ce: Export `resource` and `provide` as typed stub functions, enabling `import { Workflow, resource, provide } from "@tisyn/agent"` for authored workflow source instead of ambient declarations.

### Patch Changes

- @tisyn/ir@0.12.0
- @tisyn/kernel@0.12.0

## 0.11.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [12c9cfa]
- Updated dependencies [37bbb63]
  - @tisyn/kernel@0.11.0
  - @tisyn/ir@0.11.0

## 0.10.0

### Minor Changes

- ae02508: Standardize agent middleware around a single `Effects.around()` mechanism. `useAgent()` now returns an `AgentFacade` backed by a per-agent Context API with direct operation methods and `.around()` for per-operation middleware. Local bindings now use `Agents.use(declaration, handlers)`, and binding checks are routing-owned through `resolve()` rather than a separate bound-agent registry. Remove `BoundAgentsContext`, `EnforcementContext`, `installEnforcement`, and `EnforcementFn` so cross-boundary constraints flow through ordinary `Effects.around()` middleware.

### Patch Changes

- ae8d61c: Enforce curly braces on all control flow statements.
- Updated dependencies [ae8d61c]
- Updated dependencies [7004d09]
  - @tisyn/ir@0.10.0
  - @tisyn/kernel@0.10.0

## 0.9.0

### Patch Changes

- @tisyn/ir@0.9.0
- @tisyn/kernel@0.9.0

## 0.9.0

### Patch Changes

- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
  - @tisyn/ir@0.9.0
  - @tisyn/kernel@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b515855]
  - @tisyn/kernel@0.8.0
  - @tisyn/ir@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [f074970]
- Updated dependencies [f074970]
  - @tisyn/ir@0.7.0
  - @tisyn/kernel@0.7.0

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
