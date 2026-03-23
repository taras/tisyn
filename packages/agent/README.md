# `@tisyn/agent`

Typed agent declarations, implementations, dispatch middleware, and invocation helpers.

Use this package when you want to describe a capability as a typed agent contract and either implement it locally or call it through the runtime/transport stack.

## Main exports

- `agent()`
- `operation()`
- `implementAgent()`
- `Dispatch` / `dispatch()`
- `invoke()`

## Define an agent

```ts
import { agent, operation } from "@tisyn/agent";

const shopify = agent("shopify", {
  createOrder: operation<
    { customerId: string; lineItems: Array<{ sku: string; quantity: number }> },
    { orderId: string; status: string }
  >(),
});
```

Calling a declared operation produces invocation data. It does not execute anything yet.

```ts
const invocation = shopify.createOrder({
  customerId: "123",
  lineItems: [{ sku: "ABC", quantity: 2 }],
});
// { effectId: "shopify.createOrder", data: { ... } }
```

## Implement an agent

```ts
import { implementAgent } from "@tisyn/agent";

const shopifyImpl = implementAgent(shopify, {
  *createOrder(input) {
    return { orderId: "order-1", status: "created" };
  },
});

yield* shopifyImpl.install();
```

`install()` adds dispatch middleware to the current Effection scope. `call()` is available on the returned implementation when you want to invoke a bound handler directly without going through `invoke()`.

## Dispatch invocations with `invoke()`

```ts
import { invoke } from "@tisyn/agent";

const result = yield* invoke(
  shopify.createOrder({
    customerId: "123",
    lineItems: [{ sku: "ABC", quantity: 2 }],
  }),
);
```

This is useful:

- on the host, after installing a local or remote agent
- inside another implementation, when one agent delegates to another

```ts
const shopifyImpl = implementAgent(shopify, {
  *createOrder(input) {
    return yield* invoke(
      graphql.execute({
        document: CREATE_ORDER_MUTATION,
        variables: { input },
      }),
    );
  },
});
```

## Relationship to the rest of Tisyn

- Pair `@tisyn/agent` with [`@tisyn/runtime`](../runtime/README.md) when you want to run Tisyn programs that dispatch effects.
- Pair it with [`@tisyn/transport`](../transport/README.md) when those agent calls need to cross process or network boundaries.
- [`@tisyn/protocol`](../protocol/README.md) defines the wire messages used by remote transports, but `@tisyn/agent` itself stays protocol-agnostic.
