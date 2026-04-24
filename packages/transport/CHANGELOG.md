# @tisyn/transport

## 0.16.0

### Patch Changes

- f4012af: Switch `@tisyn/transport/browser-executor` internals to import `execute` and `InMemoryStream` from the new `@tisyn/runtime/execute` and `@tisyn/durable-streams/browser` subpaths, so Vite/browser bundles of `createBrowserExecutor` and `createInProcessRunner` no longer drag Node built-ins through transitive root re-exports. No public API change.
  - @tisyn/agent@0.16.0
  - @tisyn/ir@0.16.0
  - @tisyn/kernel@0.16.0
  - @tisyn/protocol@0.16.0
  - @tisyn/validate@0.16.0
  - @tisyn/effects@0.3.1

## 0.15.0

### Minor Changes

- e7d62c6: **BREAKING:** `installRemoteAgent()` and `installAgentTransport()`
  now register their dispatch middleware at `{ at: "min" }` (below
  user middleware) instead of the default max priority. User-installed
  `Effects.around` interceptors, including those installed after the
  transport binding, continue to observe and can transform an outbound
  dispatch before the transport routes the request — the change to
  `min` makes the transport handler sit strictly below the
  user-middleware region.

  This prepares the ground for the replay-aware dispatch boundary
  planned in #125, which will sit between max-priority user middleware
  and min-priority framework handlers. No replay logic is introduced
  yet.

  `resolve` middleware (used by `useAgent` binding-probe) is **not**
  moved — it remains at default priority. The single previous
  `Effects.around({ dispatch, resolve })` registration in each
  install entry point is now split into two separate `Effects.around`
  calls so the priority change is scoped to dispatch only.

  Callers that already install their own `{ at: "min" }` core handlers
  downstream of `installRemoteAgent` / `installAgentTransport` should
  note that two min-priority entries now coexist; relative ordering
  between them follows registration order.

- 51d11f5: `installRemoteAgent` and `installAgentTransport` now preserve the
  adapter-supplied `error.name` when reconstructing thrown `Error`s
  from `executeApplicationError` messages. Previously the name was
  dropped and the workflow surface always saw `name === "Error"`.

  Adapters that set distinct names (e.g. `InvalidPayload`,
  `SessionNotFound`, `NotSupported`) round-trip those names to the
  caller and can be branched on by `instanceof`-style discrimination
  or `err.name === "..."` checks.

- 4766e26: Documentation: README example updated to use the unwrapped
  single-parameter payload shape. `math.double({ value: 21 })`
  replaces the previous `math.double({ input: { value: 21 } })`
  form, matching the new compiler lowering rule.

  No runtime API changes in this package — the bump tracks the
  fixed-group `@tisyn/compiler` change that drives the new payload
  shape.

### Patch Changes

- Updated dependencies [e7d62c6]
- Updated dependencies [4766e26]
- Updated dependencies [29707e6]
- Updated dependencies [c268fc0]
- Updated dependencies [969d91f]
- Updated dependencies [ad2e267]
- Updated dependencies [dde36c6]
- Updated dependencies [0f255bf]
- Updated dependencies [2037b6b]
- Updated dependencies [29707e6]
  - @tisyn/agent@0.15.0
  - @tisyn/effects@0.3.0
  - @tisyn/ir@0.15.0
  - @tisyn/kernel@0.15.0
  - @tisyn/protocol@0.15.0
  - @tisyn/validate@0.15.0

## 0.14.0

### Minor Changes

- c792d86: Transport implementations and their tests now import
  `Effects`/`installCrossBoundaryMiddleware`/`getCrossBoundaryMiddleware` from
  `@tisyn/effects` and `evaluateMiddlewareFn` from `@tisyn/effects/internal`.
  Public transport surface (`installRemoteAgent`, `useTransport`,
  `createProtocolServer`, transport factories) is unchanged. Users composing
  transports with custom cross-boundary middleware must import those symbols
  from `@tisyn/effects`; they are no longer reachable through `@tisyn/agent`.

### Patch Changes

- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
  - @tisyn/agent@0.14.0
  - @tisyn/effects@0.2.0
  - @tisyn/ir@0.14.0
  - @tisyn/kernel@0.14.0
  - @tisyn/protocol@0.14.0
  - @tisyn/validate@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [db46668]
- Updated dependencies [12f992d]
  - @tisyn/agent@0.13.0
  - @tisyn/ir@0.13.0
  - @tisyn/kernel@0.13.0
  - @tisyn/protocol@0.13.0
  - @tisyn/validate@0.13.0

## 0.12.0

### Patch Changes

- 9801960: The mock LLM test helper now suspends cleanly when configured to never complete, instead of sleeping for a near-infinite duration.
- Updated dependencies [34d48ce]
  - @tisyn/agent@0.12.0
  - @tisyn/ir@0.12.0
  - @tisyn/kernel@0.12.0
  - @tisyn/protocol@0.12.0
  - @tisyn/validate@0.12.0

## 0.11.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [12c9cfa]
- Updated dependencies [37bbb63]
  - @tisyn/kernel@0.11.0
  - @tisyn/runtime@0.11.0
  - @tisyn/agent@0.11.0
  - @tisyn/ir@0.11.0
  - @tisyn/durable-streams@0.11.0
  - @tisyn/protocol@0.11.0
  - @tisyn/validate@0.11.0

## 0.10.0

### Patch Changes

- d918311: Persist the real-browser executor across full document navigations by registering it with Playwright init scripts and re-waiting for executor readiness after durable browser navigations.
- ae8d61c: Enforce curly braces on all control flow statements.
- ae02508: Replace the protocol-server enforcement path with ordinary `Effects.around()` middleware for cross-boundary constraints. Remote bindings installed through `useTransport()` / `installRemoteAgent()` now report availability through routing-owned `resolve` middleware instead of a separate bound-agent registry. Transport no longer uses `BoundAgentsContext`.
- Updated dependencies [ae8d61c]
- Updated dependencies [ae02508]
- Updated dependencies [ae02508]
- Updated dependencies [7004d09]
  - @tisyn/agent@0.10.0
  - @tisyn/ir@0.10.0
  - @tisyn/kernel@0.10.0
  - @tisyn/runtime@0.10.0
  - @tisyn/validate@0.10.0
  - @tisyn/protocol@0.10.0
  - @tisyn/durable-streams@0.10.0

## 0.9.0

### Minor Changes

- 34533e6: Add `LocalAgentBinding` and `LocalServerBinding` types as the stable contract for local/inprocess transport modules. `LocalAgentBinding` pairs a transport factory with an optional `bindServer` hook for receiving browser connections. `LocalServerBinding` provides the server address and accepted WebSocket connections as a typed stream. Move `@types/ws` to dependencies for the `WebSocket` type in `LocalServerBinding`.

### Patch Changes

- Updated dependencies [e6696fb]
- Updated dependencies [8d82f9c]
  - @tisyn/runtime@0.9.0
  - @tisyn/agent@0.9.0
  - @tisyn/ir@0.9.0
  - @tisyn/kernel@0.9.0
  - @tisyn/protocol@0.9.0
  - @tisyn/validate@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.9.0

### Patch Changes

- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
- Updated dependencies [7ad2031]
- Updated dependencies [8eb99d9]
- Updated dependencies [6b2a66a]
- Updated dependencies [38d9ffc]
- Updated dependencies [38d9ffc]
  - @tisyn/ir@0.9.0
  - @tisyn/kernel@0.9.0
  - @tisyn/runtime@0.9.0
  - @tisyn/validate@0.9.0
  - @tisyn/agent@0.9.0
  - @tisyn/protocol@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b515855]
- Updated dependencies [b515855]
  - @tisyn/kernel@0.8.0
  - @tisyn/runtime@0.8.0
  - @tisyn/agent@0.8.0
  - @tisyn/durable-streams@0.8.0
  - @tisyn/ir@0.8.0
  - @tisyn/protocol@0.8.0
  - @tisyn/validate@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [f074970]
- Updated dependencies [f074970]
- Updated dependencies [f074970]
  - @tisyn/ir@0.7.0
  - @tisyn/kernel@0.7.0
  - @tisyn/validate@0.7.0
  - @tisyn/agent@0.7.0
  - @tisyn/protocol@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [e4dc3d9]
- Updated dependencies [1f58703]
  - @tisyn/agent@0.6.0
  - @tisyn/kernel@0.6.0
  - @tisyn/ir@0.6.0
  - @tisyn/protocol@0.6.0
  - @tisyn/validate@0.6.0

## 0.5.2

### Patch Changes

- f47f4ca: Move Node.js-specific transports to subpath exports to fix browser bundling.

  - Main entry no longer re-exports `stdioTransport`, `websocketTransport`, `workerTransport`, `ssePostTransport`, `createStdioAgentTransport`, or `createSsePostAgentTransport`
  - Each transport is now available via its own subpath: `@tisyn/transport/stdio`, `@tisyn/transport/websocket`, `@tisyn/transport/worker`, `@tisyn/transport/sse-post`, `@tisyn/transport/stdio-agent`, `@tisyn/transport/sse-post-agent`
  - @tisyn/agent@0.5.2
  - @tisyn/ir@0.5.2
  - @tisyn/kernel@0.5.2
  - @tisyn/protocol@0.5.2
  - @tisyn/validate@0.5.2

## 0.5.1

### Patch Changes

- c35a0c9: Remove `transportComplianceSuite` from main entry to avoid requiring vitest at runtime.

  - The compliance suite (which imports vitest) is no longer re-exported from `@tisyn/transport`
  - Added `@tisyn/transport/compliance` subpath export for test authors who need it
  - @tisyn/agent@0.5.1
  - @tisyn/ir@0.5.1
  - @tisyn/kernel@0.5.1
  - @tisyn/protocol@0.5.1
  - @tisyn/validate@0.5.1

## 0.5.0

### Minor Changes

- e71915d: Extract `installAgentTransport` as a low-level transport primitive.

  - New `installAgentTransport(agentId, factory)` takes a plain agent-ID string and factory instead of a typed `AgentDeclaration`; sends empty capabilities (`methods: []`)
  - Used by the runtime scope orchestrator where only the agent-ID string and factory value are available from the IR environment
  - `installRemoteAgent` is unchanged; `installAgentTransport` is an independent addition

### Patch Changes

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
  - @tisyn/validate@0.5.0
  - @tisyn/agent@0.5.0
  - @tisyn/protocol@0.5.0

## 0.4.0

### Minor Changes

- 0393e25: Add `useTransport()` and middleware enforcement wiring to the transport package.

  - New `useTransport(declaration, factory)` operation registers an agent in the scope-local bound-agents registry and installs the remote agent dispatch middleware; transport lifetime is scoped to the calling Effection scope
  - `createProtocolServer` now extracts `params.middleware` from execute requests, validates it via `assertValidIr` + `isFnNode` (responding with `InvalidRequest` on failure), installs an enforcement wrapper via `installEnforcement()`, and re-installs it as the cross-boundary middleware carrier so delegated executions propagate the same constraint to their children

  ```ts
  yield *
    scoped(function* () {
      yield* useTransport(Coder, coderTransport);
      yield* useTransport(Reviewer, reviewerTransport);

      yield* Effects.around({
        *dispatch([effectId, data], next) {
          if (effectId === "tisyn.exec") {
            throw new Error("exec denied in this scope");
          }
          return yield* next(effectId, data);
        },
      });

      const coder = yield* useAgent(Coder);
      const reviewer = yield* useAgent(Reviewer);

      const patch = yield* coder.implement(spec);
      return yield* reviewer.review(patch);
    });
  ```

  Agents are bound to the scope via `useTransport()`, middleware constraints are installed via `Effects.around()`, and typed handles are retrieved via `useAgent()`. When a parent delegates to a remote child with `installCrossBoundaryMiddleware()`, the protocol carries the middleware IR to the child, which installs it as a non-bypassable enforcement wrapper for that execution and re-propagates it to any further remote delegations.

### Patch Changes

- Updated dependencies [0393e25]
- Updated dependencies [0393e25]
- Updated dependencies [0393e25]
  - @tisyn/agent@0.4.0
  - @tisyn/kernel@0.4.0
  - @tisyn/protocol@0.4.0
  - @tisyn/ir@0.4.0
  - @tisyn/validate@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [4375b0a]
- Updated dependencies [4375b0a]
  - @tisyn/ir@0.3.0
  - @tisyn/kernel@0.3.0
  - @tisyn/agent@0.3.0
  - @tisyn/protocol@0.3.0

## 0.2.0

### Minor Changes

- 5551c2d: Add a `protocol-server` subpath export so server-side transport wiring is available
  through a stable package entrypoint.

### Patch Changes

- Updated dependencies [3302f6a]
- Updated dependencies [5551c2d]
- Updated dependencies [5551c2d]
- Updated dependencies [3302f6a]
  - @tisyn/ir@0.2.0
  - @tisyn/agent@0.2.0
  - @tisyn/kernel@0.2.0
  - @tisyn/protocol@0.2.0
