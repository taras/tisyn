# `@tisyn/agent`

`@tisyn/agent` defines the typed capability boundary between Tisyn workflows and the work that actually gets performed. It turns effectful calls into explicit contracts: named agent boundaries, typed operation payloads, and handlers the runtime can dispatch locally or across a transport boundary.

If `@tisyn/ir` describes **what work should happen**, `@tisyn/agent` describes **who can do it and how it is called**.

## Where It Fits

This package sits between authored workflow logic and concrete side effects.

- The compiler lowers authored calls like `yield* Service().method(...)` into effectful IR.
- The runtime resolves those effects through installed agent handlers.
- The transport layer can expose the same declarations across process, worker, or network boundaries.

`@tisyn/agent` is the capability layer that gives effect IDs stable names, payload shapes, and implementations.

## Core Concepts

- `agent(id, operations)` declares a named capability boundary.
- `operation<Spec>()` declares one typed operation on that boundary.
- `implementAgent()` binds handlers to a declaration.
- `Effects.around()` installs Effection middleware layers that intercept or route effect invocations.
- `dispatch()` performs an effect call through the current `Effects` middleware boundary.
- `invoke()` executes a declared operation against the current dispatch stack.
- `useAgent()` retrieves a typed facade for an agent bound in the current scope via `useTransport()`. The facade exposes direct methods for each operation plus `.around()` for per-operation middleware.

Agent declarations are typed metadata plus call helpers. They describe invocations, but do not execute anything by themselves.

## Public API

The public surface exported from `src/index.ts` includes:

- `agent` — declare a named agent boundary and its available operations
- `operation` — declare the typed input/output contract for one operation
- `implementAgent` — bind handlers to a declaration so the runtime can dispatch them
- `Effects` — the Effection middleware context for invocation routing; use `Effects.around()` to install intercept layers
- `dispatch` — perform an effect call through the current `Effects` middleware boundary
- `invoke` — execute a declared operation against the current dispatch stack
- `useAgent` — retrieve a typed facade for an agent previously bound via `useTransport()`; returns an object with one method per operation plus `.around()`
- `installCrossBoundaryMiddleware` — install an IR function node as the cross-boundary middleware carrier for further remote delegation
- `getCrossBoundaryMiddleware` — read the current cross-boundary middleware carrier from scope (returns `null` if not set)
- `evaluateMiddlewareFn` — drive an IR function node as a middleware function with scope-local dispatch semantics

Important exported types:

- `OperationSpec` — describe the typed input and result shape of an operation
- `DeclaredAgent` — represent the callable declaration returned by `agent()`
- `AgentDeclaration` — structural type for a declared agent contract
- `AgentImplementation` — declaration paired with handlers and install logic
- `ImplementationHandlers` — type the handler map expected by `implementAgent()`
- `Invocation` — represent one concrete operation call ready for dispatch
- `ArgsOf` — extract the input shape from an operation declaration
- `ResultOf` — extract the result type from an operation declaration
- `Workflow` — represent the authored workflow return type used in ambient declarations
- `AgentFacade` — typed facade returned by `useAgent()`, with per-operation methods and `.around()`
- `AgentHandle` — deprecated alias for `AgentFacade`

## Declare an Agent

```ts
import { agent, operation } from "@tisyn/agent";

const orders = agent("orders", {
  fetch: operation<{ input: { orderId: string } }, { id: string; total: number }>(),
  cancel: operation<{ input: { orderId: string } }, void>(),
});
```

Calling a declared operation produces an invocation description. It is a typed effect request, not a direct function call.

```ts
const request = orders.fetch({ input: { orderId: "ord-1" } });
```

## Implement Handlers

```ts
import { implementAgent } from "@tisyn/agent";

const ordersImpl = implementAgent(orders, {
  *fetch({ input }) {
    return { id: input.orderId, total: 42 };
  },

  *cancel() {},
});

```

The implementation exposes `call(opName, payload)` for use by protocol servers. To make the handlers reachable at the dispatch layer, pass the implementation to a transport (see `@tisyn/transport`).

## Use an Agent with Per-Operation Middleware

`useAgent()` returns a facade backed by a per-agent Context API with one operation per declared operation.

```ts
import { useAgent } from "@tisyn/agent";

const ordersFacade = yield* useAgent(orders);

// Direct method dispatch
const order = yield* ordersFacade.fetch({ input: { orderId: "ord-1" } });

// Per-operation middleware via .around()
yield* ordersFacade.around({
  *fetch([args], next) {
    console.log("fetching order:", args);
    return yield* next(args);
  },
});
```

Facade middleware composes before the global `Effects` middleware chain:

```
facade.around MW → facade core handler → dispatch() → Effects.around MW → Effects core
```

Multiple `useAgent()` calls with the same declaration in the same scope share middleware visibility — middleware installed via one reference is visible to all. Child-scope facade middleware inherits down but does not affect the parent scope.

## Invoke an Operation

```ts
import { invoke } from "@tisyn/agent";

const order = yield* invoke(
  orders.fetch({ input: { orderId: "ord-1" } }),
);
```

This is useful when:

- application code wants to call an installed agent directly
- one agent implementation delegates work to another

```ts
const checkoutImpl = implementAgent(checkout, {
  *complete({ input }) {
    const order = yield* invoke(
      orders.fetch({ input: { orderId: input.orderId } }),
    );

    return { ok: order.total > 0 };
  },
});
```

## Mental Model

An agent declaration gives Tisyn a typed, named capability boundary.

- **Declarations** define what operations exist and what they accept or return.
- **Invocations** describe one requested operation call.
- **Implementations** attach concrete handlers to those declarations.
- **Facades** (from `useAgent()`) expose per-operation dispatch methods and `.around()` for per-operation middleware.
- **Effects middleware** decides how invocations are routed.
- **Cross-boundary constraints** are installed as ordinary `Effects.around()` middleware in the execution scope — there is no separate enforcement mechanism.

That routing can stay local, or it can be forwarded through another layer such as a worker or network transport. `@tisyn/agent` stays focused on the contract and dispatch shape rather than the transport itself.

## Relationship to the Rest of Tisyn

- Use `@tisyn/agent` with [`@tisyn/runtime`](../runtime/README.md) when executing IR against real effect handlers.
- Use it with [`@tisyn/transport`](../transport/README.md) when those handlers must be reached across process, worker, or network boundaries.
- [`@tisyn/compiler`](../compiler/README.md) discovers effect usage from authored workflow source, but does not execute effects.
- [`@tisyn/protocol`](../protocol/README.md) defines wire messages for remote execution, but `@tisyn/agent` itself remains protocol-agnostic.

## What This Package Does Not Define

`@tisyn/agent` does not define:

- the IR language
- durable execution
- replay semantics
- transport or protocol messages

It defines the typed capability layer that those systems rely on.

## Summary

Use `@tisyn/agent` when you want effectful workflow calls to become explicit, typed capability contracts.

It gives Tisyn a stable boundary between workflow intent and concrete execution: declarations name the capability, operations define the payload shape, implementations provide handlers, facades expose per-operation middleware, and dispatch makes invocation routable wherever the work actually happens.
