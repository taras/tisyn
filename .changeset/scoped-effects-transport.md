---
"@tisyn/transport": minor
---

Add `useTransport()` and middleware enforcement wiring to the transport package.

- New `useTransport(declaration, factory)` operation registers an agent in the scope-local bound-agents registry and installs the remote agent dispatch middleware; transport lifetime is scoped to the calling Effection scope
- `createProtocolServer` now extracts `params.middleware` from execute requests, validates it via `assertValidIr` + `isFnNode` (responding with `InvalidRequest` on failure), installs an enforcement wrapper via `installEnforcement()`, and re-installs it as the cross-boundary middleware carrier so delegated executions propagate the same constraint to their children

```ts
yield* scoped(function* () {
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
