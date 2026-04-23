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
- `Agents.use()` binds handlers directly to a declaration in the current scope, installing routing and resolve middleware.
- `Effects.around()` installs Effection middleware layers that intercept or route effect invocations.
- `dispatch()` performs an effect call through the current `Effects` middleware boundary. It accepts either an explicit `(effectId, data)` pair or a call descriptor object produced by `agent().op(args)`.
- `resolve()` queries the Effects middleware chain to check if an agent is bound in the current scope.
- `useAgent()` retrieves a typed facade for an agent bound in the current scope via `Agents.use()` or `useTransport()`. The facade exposes direct methods for each operation plus `.around()` for per-operation middleware.

Agent declarations are typed metadata plus call helpers. They describe invocations, but do not execute anything by themselves.

## Public API

The authoring surface exported from `src/index.ts` includes:

- `agent` — declare a named agent boundary and its available operations
- `operation` — declare the typed input/output contract for one operation
- `Agents` — setup namespace; `Agents.use(declaration, handlers)` binds handlers directly in the current scope
- `implementAgent` — create an `AgentImplementation` object for use by protocol servers and transports (internal/advanced)
- `useAgent` — retrieve a typed facade for an agent previously bound via `Agents.use()` or `useTransport()`; returns an object with one method per operation plus `.around()`

The dispatch-boundary surface lives in [`@tisyn/effects`](../effects/README.md):

- `Effects` — the Effection middleware context for invocation routing; use `Effects.around()` to install intercept layers
- `dispatch` — perform an effect call through the current `Effects` middleware boundary. Accepts either `(effectId, data)` or a `{ effectId, data }` descriptor returned by `agent().op(args)`
- `resolve` — query the Effects middleware chain to check if an agent is bound
- `invoke` — invoke another declared operation from inside a handler, with nested-invocation guarantees
- `runAsTerminal` — mark terminal handler work so replay can substitute the stored result instead of re-firing the external side effect
- `installCrossBoundaryMiddleware` — install an IR function node as the cross-boundary middleware carrier for further remote delegation
- `getCrossBoundaryMiddleware` — read the current cross-boundary middleware carrier from scope (returns `null` if not set)
- `InvalidInvokeCallSiteError`, `InvalidInvokeInputError`, `InvalidInvokeOptionError` — error classes thrown by `invoke` on misuse

These symbols are published only by `@tisyn/effects`; `@tisyn/agent` does not re-export them. The workspace-only seam (`DispatchContext`, `evaluateMiddlewareFn`) lives on the non-stable `@tisyn/effects/internal` subpath and is not part of the stable public surface.

Important exported types:

- `OperationSpec` — describe the typed input and result shape of an operation
- `DeclaredAgent` — represent the callable declaration returned by `agent()`
- `AgentDeclaration` — structural type for a declared agent contract
- `AgentImplementation` — declaration paired with handlers and install logic
- `ImplementationHandlers` — type the handler map expected by `Agents.use()` and `implementAgent()`
- `ArgsOf` — extract the input shape from an operation declaration
- `ResultOf` — extract the result type from an operation declaration
- `Workflow` — represent the authored workflow return type used in ambient declarations
- `AgentFacade` — typed facade returned by `useAgent()`, with per-operation methods and `.around()`
- `AgentHandle` — deprecated alias for `AgentFacade`

## Declare an Agent

```ts
import { agent, operation } from "@tisyn/agent";

const orders = agent("orders", {
  fetch: operation<{ orderId: string }, { id: string; total: number }>(),
  cancel: operation<{ orderId: string }, void>(),
  transfer: operation<{ from: string; to: string }, void>(),
});
```

Calling a declared operation produces a call descriptor. It is a typed effect request, not a direct function call.

```ts
const request = orders.fetch({ orderId: "ord-1" });
```

Single-parameter ambient methods pass their argument through directly as the operation payload. Multi-parameter ambient methods are still wrapped into a named object keyed by the authored parameter names — `transfer(from: string, to: string)` lowers to `{ from, to }`.

## Bind Handlers Locally

`Agents.use()` binds typed handlers directly to a declaration in the current scope. It installs both dispatch routing and resolve middleware — `useAgent()` will succeed for this agent after this call.

```ts
import { Agents } from "@tisyn/agent";

yield* Agents.use(orders, {
  *fetch({ orderId }) {
    return { id: orderId, total: 42 };
  },
  *cancel() {},
  *transfer({ from, to }) {
    // multi-parameter methods receive a named object payload
  },
});
```

For transport or protocol server use cases, `implementAgent()` creates an `AgentImplementation` object with `call(opName, payload)`. This is an internal/advanced API used by `@tisyn/transport`.

In-repo agent bindings use `runAsTerminal(...)` internally when they become the terminal dispatcher for an effect. That keeps replay safety at the framework layer: middleware still reruns during replay, but durable results substitute at the terminal boundary instead of re-invoking the live handler. Ordinary workflow code using `Agents.use()` or `useAgent()` does not need to call `runAsTerminal(...)` directly.

## Use an Agent with Per-Operation Middleware

`useAgent()` returns a facade backed by a per-agent Context API with one operation per declared operation.

```ts
import { useAgent } from "@tisyn/agent";

const ordersFacade = yield* useAgent(orders);

// Direct method dispatch
const order = yield* ordersFacade.fetch({ orderId: "ord-1" });

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

## Dispatch an Operation

```ts
import { dispatch } from "@tisyn/effects";

const order = yield* dispatch(
  orders.fetch({ orderId: "ord-1" }),
);
```

This is useful when:

- application code wants to call an installed agent directly
- one agent implementation delegates work to another

```ts
yield* Agents.use(checkout, {
  *complete({ orderId }) {
    const order = yield* dispatch(
      orders.fetch({ orderId }),
    );

    return { ok: order.total > 0 };
  },
});
```

## Mental Model

An agent declaration gives Tisyn a typed, named capability boundary.

- **Declarations** define what operations exist and what they accept or return.
- **Call descriptors** — produced by calling a declared operation (e.g. `orders.fetch(args)`) — describe one requested operation as a plain `{ effectId, data }` object.
- **Implementations** attach concrete handlers to those declarations.
- **Facades** (from `useAgent()`) expose per-operation dispatch methods and `.around()` for per-operation middleware.
- **Effects middleware** decides how dispatched calls are routed.
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
