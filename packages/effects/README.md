# `@tisyn/effects`

`@tisyn/effects` defines the dispatch boundary for Tisyn effect execution.

It provides the middleware surface that runtime, agent, transport, and advanced host integrations use to route effect calls, resolve installed capabilities, and compose replay-safe terminal work.

## Where It Fits

This package sits at the effect-routing seam:

- `@tisyn/agent` declares named capabilities and operation payloads.
- `@tisyn/runtime` evaluates IR until it reaches a standard external effect.
- `@tisyn/effects` routes that effect through the active middleware chain.
- `@tisyn/transport` and other host integrations install terminal handlers that perform the live work.

Use `@tisyn/effects` when you need to intercept, route, or terminate effect dispatch.

## Public API

- `Effects` — scope-local Effection middleware API for effect dispatch
- `dispatch` — perform an effect call through the current middleware boundary
- `resolve` — check whether an effect is currently handled in scope
- `invoke` — call another declared operation from inside middleware/handlers with nested-invocation semantics
- `invokeInline` — evaluate an IR middleware body inline with the caller's lifetime rather than a child invocation scope
- `runAsTerminal` — mark terminal live work so replay can substitute the stored result instead of re-firing side effects
- `installCrossBoundaryMiddleware` / `getCrossBoundaryMiddleware` — install or inspect the scope-local cross-boundary middleware carrier used for remote delegation

## Replay-Safe Terminal Middleware

Ordinary middleware that observes or transforms a dispatch should continue to delegate with `yield* next(effectId, data)`.

Middleware that terminates the chain and performs the effect itself must route that live work through `runAsTerminal(...)`:

```ts
import { Effects, runAsTerminal } from "@tisyn/effects";

yield* Effects.around({
  *dispatch([effectId, data], next) {
    if (effectId === "orders.fetch") {
      return yield* runAsTerminal(effectId, data, function* () {
        return yield* fetchOrder(data);
      });
    }

    return yield* next(effectId, data);
  },
});
```

On the original run, the terminal work executes normally. On replay, middleware still re-executes, but the runtime-controlled terminal boundary can substitute the stored result instead of redoing the external side effect.

Typical workflow authors and runware do **not** need to call `runAsTerminal(...)` directly. This is primarily a framework-level integration tool for terminal handlers in packages such as `@tisyn/agent` and `@tisyn/transport`, or for advanced custom middleware that truly owns the terminal work.

## Stable vs. Internal Surface

The stable public surface is the main package entrypoint documented above.

Workspace-only seams such as `DispatchContext`, `evaluateMiddlewareFn`, and `RuntimeTerminalBoundary` live under the non-stable `@tisyn/effects/internal` subpath and are for in-repo package integration only.
