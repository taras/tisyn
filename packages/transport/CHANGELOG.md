# @tisyn/transport

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
