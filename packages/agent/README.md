# `@tisyn/agent`

`@tisyn/agent` is the package that turns "a thing the runtime may call" into a typed contract. It gives Tisyn a stable effect boundary: workflows compile down to effect IDs, and agent declarations and implementations give those effect IDs names, payload shapes, and handlers.

## Where It Fits

This package sits between authored workflow logic and concrete side effects.

- The compiler lowers `yield* Service().method(...)` calls into effectful IR.
- The runtime dispatches those effects through installed agent handlers.
- The transport layer can expose the same declarations across process or network boundaries.

If `@tisyn/ir` is the language of workflows, `@tisyn/agent` is the language of capabilities.

## Core Concepts

- `agent(id, operations)`: declares a named capability boundary.
- `operation<Spec>()`: declares one typed operation on that boundary.
- `implementAgent()`: binds handlers to a declaration.
- `dispatch()` / `Dispatch`: Effection middleware that routes invocations.
- `invoke()`: executes a declared operation against the current dispatch stack.

Declarations are pure metadata plus typed call helpers. They do not execute anything by themselves.

## Main APIs

The current public surface from `src/index.ts` is:

- `agent`: Declare a named agent boundary and its available operations.
- `operation`: Declare the typed input/output contract for one operation on an agent.
- `implementAgent`: Bind generator handlers to a declaration so the runtime can dispatch to it.
- `Dispatch`: Represent the Effection middleware contract that routes invocations to handlers.
- `dispatch`: Install dispatch middleware into the current Effection scope.
- `invoke`: Execute a declared operation against the currently installed dispatch stack.

Important exported types:

- `OperationSpec`: Describe the typed input and result shape of a declared operation.
- `DeclaredAgent`: Represent the callable declaration object returned by `agent()`.
- `AgentDeclaration`: Name the structural type for a declared agent contract.
- `AgentImplementation`: Represent a declaration paired with concrete handlers and install logic.
- `ImplementationHandlers`: Type the handler map expected by `implementAgent()`.
- `Invocation`: Represent one concrete operation call ready for dispatch.
- `ArgsOf`: Extract the input shape from an operation declaration.
- `ResultOf`: Extract the result type from an operation declaration.
- `Workflow`: Represent the authored workflow return type used in ambient contract declarations.

## Define a Declaration

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

## Bind Handlers

```ts
import { implementAgent } from "@tisyn/agent";

const ordersImpl = implementAgent(orders, {
  *fetch({ input }) {
    return { id: input.orderId, total: 42 };
  },

  *cancel() {},
});

yield* ordersImpl.install();
```

`install()` registers dispatch middleware in the current Effection scope. Once installed, `invoke()` and the Tisyn runtime can route matching invocations to these handlers.

## Invoke Operations

```ts
import { invoke } from "@tisyn/agent";

const order = yield* invoke(
  orders.fetch({ input: { orderId: "ord-1" } }),
);
```

This is useful in two places:

- application code that wants to call an installed agent directly
- agent implementations that delegate to other agents

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

## Relationship to the Rest of Tisyn

- Pair `@tisyn/agent` with [`@tisyn/runtime`](../runtime/README.md) when you want Tisyn IR to dispatch real effects.
- Pair it with [`@tisyn/transport`](../transport/README.md) when those effects must cross a process, worker, or network boundary.
- [`@tisyn/compiler`](../compiler/README.md) discovers effect usage from authored workflow source, but does not execute anything.
- [`@tisyn/protocol`](../protocol/README.md) defines wire messages for remote execution, but `@tisyn/agent` itself stays protocol-agnostic.

## Boundaries

`@tisyn/agent` does not define:

- the IR language
- durable execution
- replay semantics
- network protocol messages

It defines the typed capability layer that those other packages rely on.
