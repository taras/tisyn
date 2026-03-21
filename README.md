# (T)ypeScript (I)nterpreter (Syn)tax

Tisyn (pronounced like the Chicken) is a minimal set of interfaces and
constructors to represent an abstract syntax tree that can be
interpreted.

Tisyn expressions do not come with any semantics whatsoever, they
purely express how to compose values by ensuring that the types line
up. This allows language designers to skip the development of their
own syntax while they are figuring out how execution should work.

## Agent Model

Tisyn uses a declaration-based agent model where shared declarations
define the contract between hosts and agents.

### Declarations

An `agent()` declaration defines typed operations. The declaration is
shared between host and agent — it is the single source of truth for
the operation contract.

```ts
import { agent, operation } from "@tisyn/agent";

const shopify = agent("shopify", {
  createOrder: operation<
    { customerId: string; lineItems: Array<{ sku: string; quantity: number }> },
    { orderId: string; status: string }
  >(),
});
```

### Host-side invocation

Host-side call methods construct invocation data. They do not execute
the operation — they produce a plain object describing what to call.

```ts
const invocation = shopify.createOrder({
  customerId: "123",
  lineItems: [{ sku: "ABC", quantity: 2 }],
});
// → { effectId: "shopify.createOrder", data: { customerId: "123", ... } }
```

### Agent-side implementation

Implementations bind handlers to a declaration and install them as
dispatch middleware in the current effection scope.

```ts
import { implementAgent } from "@tisyn/agent";

const shopifyImpl = implementAgent(shopify, {
  *createOrder(input) {
    // server-side logic — e.g. call a GraphQL API
    return { orderId: "order-1", status: "created" };
  },
});

yield * shopifyImpl.install();
```

### Dispatching invocations with `invoke()`

`invoke()` bridges an invocation (plain data) to a `dispatch()` call
(effection Operation). Use it on the server to dispatch received
invocations, or inside agent implementations to call other agents.

```ts
import { invoke } from "@tisyn/agent";

// Dispatch a received invocation
const result = yield * invoke(shopify.createOrder(input));

// Call another agent from within an implementation
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

### Remote Tisyn execution

For power-user scenarios, a server can receive and execute Tisyn IR
programs with `executeRemote()`. The program runs against whatever
dispatch middleware is installed in the current scope.

```ts
import { executeRemote } from "@tisyn/runtime";

const result =
  yield *
  executeRemote({
    program: receivedIR,
    env: { customerId: "123" },
  });
```

`executeRemote()` returns the result value on success or throws on
error. The thrown Error includes `cause` set to the full
`EventResult` for structured error inspection.
