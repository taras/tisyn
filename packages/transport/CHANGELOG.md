# @tisyn/transport

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
