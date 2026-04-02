# `@tisyn/compiler`

`@tisyn/compiler` turns authored Tisyn workflows into portable IR and generated TypeScript helpers.

It is the build-time bridge between the code humans author and the explicit execution structure Tisyn runtimes consume. Authors declare agent contracts and export generator workflows; the compiler validates that source, lowers it into Tisyn IR, and emits a generated module that hosts, runtimes, transports, and tests can use directly.

If `@tisyn/ir` defines the language of Tisyn, `@tisyn/compiler` is what lets authored TypeScript target that language safely.

## What This Package Does

`@tisyn/compiler` owns the boundary between authoring and execution:

- discovers ambient agent contract declarations
- validates that authored workflows stay within the supported deterministic subset
- lowers exported generator workflows into Tisyn IR
- generates a TypeScript module containing agent factories, compiled workflows, and grouped exports

The output is portable, inspectable, and ready to plug into runtime execution or transport across boundaries.

## Core Concepts

- **authored workflow source**: `declare function` contracts plus exported `function*` workflows
- **contract discovery**: extract agent metadata from authored declarations
- **IR lowering**: convert supported TypeScript workflow syntax into Tisyn IR
- **generated module output**: emit declarations, compiled workflows, and grouped maps
- **validation**: reject authored shapes the runtime cannot safely support

## Installation

```bash
npm install @tisyn/compiler
```

Dependencies such as `@tisyn/ir`, `@tisyn/validate`, and `typescript` are installed automatically.

## Quick Start

Write an authored source file with a contract and a workflow:

```typescript
// orders.workflow.ts
import type { Order } from "./types.js";

declare function OrderService(instance?: string): {
  fetchOrder(orderId: string): Workflow<Order>;
};

export function* processOrder(orderId: string) {
  const order = yield* OrderService().fetchOrder(orderId);
  return order;
}
```

Compile it:

```typescript
import { generateWorkflowModule } from "@tisyn/compiler";
import { readFileSync } from "fs";

const source = readFileSync("orders.workflow.ts", "utf-8");
const result = generateWorkflowModule(source);

// result.source     -> generated TypeScript module source
// result.contracts  -> discovered contract metadata
// result.workflows  -> compiled IR by workflow name
```

The generated module exports typed agent factories, compiled workflow IR values, and grouped `agents` / `workflows` maps.

## Where It Fits

This package sits at the authoring-to-IR boundary.

1. Authors write ambient agent contracts and exported generator workflows.
2. The compiler discovers and validates those contracts.
3. Exported workflows are lowered into Tisyn IR.
4. A generated module is emitted for use by hosts, runtimes, transports, or tests.

At build time:

```text
authored TypeScript -> compiler -> generated module
```

At runtime, that generated module is consumed by the rest of the Tisyn system.

## Main APIs

The public API from `src/index.ts` includes:

- `generateWorkflowModule`: discover contracts, compile workflows, and generate a TypeScript module
- `compile`: compile authored workflow source into IR
- `compileOne`: compile a single workflow and return its IR directly
- `DiscoveredContract`: metadata for one discovered ambient contract
- `ContractMethod`: metadata for one discovered contract method
- `CompileError`: structured compiler error with location and code
- `ErrorCodes`: stable error-code catalog for tooling and tests

The package also re-exports IR builder helpers such as `Q`, `Ref`, `Fn`, `Let`, `Call`, `ExternalEval`, `AllEval`, `RaceEval`, `ScopeEval`, `SpawnEval`, and `JoinEval`. These are primarily useful for compiler internals and low-level tooling, not the main entrypoint most consumers should start with.

## Authoring Model

### Contract Declarations

Contracts declare the external agent operations a workflow may call. They use ambient TypeScript function declarations:

```typescript
declare function ServiceName(instance?: string): {
  methodName(param: ParamType): Workflow<ResultType>;
};
```

Example:

```typescript
import type { Order, OrderUpdate, Receipt } from "./types.js";

declare function OrderService(instance?: string): {
  fetchOrder(orderId: string): Workflow<Order>;
  updateOrder(orderId: string, data: OrderUpdate): Workflow<Order>;
  refund(orderId: string, amount: number): Workflow<Receipt>;
};
```

Rules:

- Contracts must use `declare function` and have no body.
- A contract factory may accept zero parameters or one parameter.
- If present, that parameter must be `instance?: string`.
- The return type must be an inline object type literal containing method signatures.
- Each method must return `Workflow<T>` with exactly one type argument.
- Each method must have at least one parameter in v1.
- Method parameters must not be optional or rest parameters in v1.
- Each parameter must have an explicit type annotation.

Example without an instance parameter:

```typescript
declare function ConfigService(): {
  getValue(key: string): Workflow<string>;
};
```

### Workflow Functions

Workflows are exported generator functions:

```typescript
export function* processOrder(orderId: string) {
  const order = yield* OrderService().fetchOrder(orderId);

  if (order.total > 1000) {
    const receipt = yield* PaymentService().chargeCard(order.paymentInfo);
    return receipt;
  }

  return order;
}
```

Rules:

- Workflows must be generator functions (`function*`).
- They must be exported to appear in generated output.
- `yield*` calls to contract methods invoke agent operations.
- Non-exported generator functions are ignored.

Supported constructs include:

- `const` declarations
- `if` / `else`
- `while`
- `for (const x of yield* each(sourceExpr)) { ... }`
- `throw new Error(...)`
- `try / catch / finally`
- object literals
- array literals
- template literals
- ternary expressions
- arrow functions with expression bodies only

See [Restrictions and Errors](#restrictions-and-errors) for unsupported constructs.

### `let` Declarations and Loop-Carried State

`let` variables may be declared and reassigned within a workflow body. The compiler SSA-lowers each reassignment to a fresh versioned binding:

```typescript
let x = 0;
x = x + 1;   // becomes x_1 = x_0 + 1 in IR
x = x + 1;   // becomes x_2 = x_1 + 1 in IR
```

When a `let` variable is reassigned inside a `while` loop body, the loop uses the recursive Fn + Call pattern with the variable as a loop-carried parameter:

```typescript
let count = 0;
while (count < 10) {
  count = count + 1;
}
```

The loop expression evaluates to the last body result (`count + 1` = 10 when the condition first becomes false).

After the loop exits, the compiler rebinds each loop-carried variable in the outer scope to its final value. Code following the loop sees the post-loop version:

```typescript
let x = 0;
while (x < target) {
  x = x + step;
}
return x;   // returns the final value of x after the loop
```

### Stream Iteration

`for (const x of yield* each(sourceExpr)) { ... }` is the only supported `for...of` form.

Example:

```typescript
export function* run(source: unknown) {
  let count = 0;

  for (const item of yield* each(source)) {
    count = count + 1;
    yield* OrderService().process(item);
  }

  return count;
}
```

Lowering shape:

- one `ExternalEval("stream.subscribe", [compiledSource])` before the loop
- one recursive `Fn` containing `ExternalEval("stream.next", [Ref("__sub_N")])`
- one `If(Get(Ref("__item_N"), "done"), ...)` dispatch per iteration
- the same loop-carried-state packing/rebinding rules used for `while` when outer `let` bindings are reassigned in the loop body

Rules:

- only `for (const x of yield* each(expr))` is accepted
- `let`, `var`, and destructuring bindings are rejected
- `each()` may only appear in that iterable position
- `each.next()` is not part of the authored language
- nested stream-iteration loops are rejected in this MVP

### Scoped Blocks

`yield* scoped(function* () { ... })` declares a lifecycle-bounded scope inside a workflow. The scoped block establishes transport connections and an optional enforcement handler for the duration of its body, then tears everything down when the body exits.

A scoped block has two regions: a **setup region** followed by a **body region**. Setup statements must come first.

**Setup region** (optional, before any body statements):

- `yield* useTransport(Contract, factoryExpr)` — connect a remote agent. Each contract may appear at most once per `scoped()` block. The second argument may be any expression that evaluates to an `AgentTransportFactory` without performing effects (bare identifier, property access, call expression, ternary, etc.).
- `yield* Effects.around({ *dispatch([id, data], next) { ... } })` — install an enforcement handler that intercepts all dispatch inside the body. At most one per `scoped()` block.

**Body region**:

- `const handle = yield* useAgent(Contract)` — declare a handle variable for a connected contract. This declaration is erased at compile time; the variable is recorded for method-call lowering only.
- `yield* handle.method(args)` — invoke a method on a connected contract. Lowered to `ExternalEval("prefix.method", Construct({ param: value, ... }))` using the contract's method signature.

Example:

```typescript
export function* run(factory: AgentTransportFactory) {
  return yield* scoped(function* () {
    yield* useTransport(MyService, factory);
    yield* Effects.around({
      *dispatch([id, data], next) {
        if (id === "my-service.doWork") {
          return yield* next(id, data);
        }
        throw new Error(`Unexpected effect: ${id}`);
      },
    });
    const handle = yield* useAgent(MyService);
    return yield* handle.doWork({ input: "hello" });
  });
}
```

Rules:

- `scoped()` may only be used inside a workflow function compiled with contract context available.
- All `useTransport` and `Effects.around` calls must precede any body statements.
- `useAgent` may only be used inside a `scoped()` body and requires a matching `useTransport` in the same block.
- `yield* handle.method(args)` argument count must match the contract method signature.

### Structured Child Tasks

`yield* spawn(function* () { ... })` starts a child task under the current workflow and returns a task handle. That handle may later be joined with `yield* task`.

Example:

```typescript
export function* run(flag: boolean) {
  const task = yield* spawn(function* () {
    if (flag) return 42;
    return 0;
  });

  return yield* task;
}
```

Lowering shape:

- `yield* spawn(function* () { ... })` lowers to `SpawnEval(Q(Fn(...)))`
- `yield* task` lowers to `JoinEval(Ref("task"))`

Rules:

- `spawn()` takes exactly one inline generator-function expression.
- A spawn handle must be declared with `const`, not `let`.
- Spawn handles are join-only authored values. They are not ordinary data and may not be returned, stored in objects or arrays, or passed through general expression positions.
- Inside a spawned body, ordinary lexical bindings from the parent remain visible.
- Inside a spawned body, parent `useAgent(...)` handles are not visible.
- Inside a spawned body, parent spawn handles are not visible. Nested spawned bodies must create and join their own task handles.
- A joined task handle should be treated as single-use. The runtime rejects duplicate joins of the same task.

### Resources

`yield* resource(function* () { ... })` declares a resource with an init/cleanup lifecycle. The resource body must call `yield* provide(value)` exactly once to supply a value to the parent.

Example:

```typescript
export function* run() {
  const conn = yield* resource(function* () {
    const c = yield* DbService().connect();
    try {
      yield* provide(c);
    } finally {
      yield* DbService().disconnect(c);
    }
  });

  return yield* DbService().query(conn, "SELECT 1");
}
```

Lowering shape:

- `yield* resource(function* () { ... })` lowers to `ResourceEval(bodyExpr)` with the body Quote-wrapped
- `yield* provide(value)` lowers to `ProvideEval(compiledValue)` (not Quote-wrapped)

Rules:

- `resource()` takes exactly one inline generator-function expression (RS1).
- The resource body must contain exactly one `provide` call (RS4).
- `provide` must not appear outside a resource body (P2).
- `provide` must appear at the top level of the body or inside the try block of a top-level try/finally (P4/P5).
- `provide` must not appear inside `if`, `while`, `scoped`, `spawn`, or nested generators (P5).
- No code may follow `provide` at the same nesting level (P6). Use try/finally for cleanup.
- `provide` requires exactly one argument (P1).
- Nested `resource()` inside a resource body is not supported (RS7).

## Workflow Calls and Lowering

When a workflow calls a contract method with `yield*`, the compiler lowers that call to an `ExternalEval` IR node.

Authored source:

```typescript
const order = yield* OrderService().fetchOrder(orderId);
```

Conceptual IR:

```typescript
ExternalEval("order-service.fetchOrder", Construct({ orderId: Ref("orderId") }))
```

### Positional-to-payload normalization

Contract parameter names determine the payload shape. For a method like:

```typescript
fetchOrder(orderId: string, includeLines: boolean): Workflow<Order>;
```

this call:

```typescript
yield* OrderService().fetchOrder(id, true);
```

becomes a payload equivalent to:

```typescript
{ orderId: id, includeLines: true }
```

### Instance-aware IDs

If the factory is called with an instance string, the instance is appended to the base agent ID:

```typescript
yield* OrderService("legacy").fetchOrder(orderId);
// agent id:  "order-service:legacy"
// effect id: "order-service:legacy.fetchOrder"
```

Without an instance:

```typescript
yield* OrderService().fetchOrder(orderId);
// agent id:  "order-service"
// effect id: "order-service.fetchOrder"
```

The contract must be declared in the same source file as the workflows that reference it.

## Generated Output Shape

The compiler generates a TypeScript module with this overall structure:

```typescript
// Auto-generated by @tisyn/compiler — do not edit
import { agent, operation } from "@tisyn/agent";
import type { Order } from "./types.js";

export function OrderService(instance?: string) {
  const id = instance ? `order-service:${instance}` : "order-service";
  return agent(id, {
    fetchOrder: operation<{ orderId: string }, Order>(),
  });
}

export const processOrder = {
  type: "fn",
  params: ["orderId"],
  body: {
    // ... compiled IR tree
  },
} as const;

export const agents = { OrderService };
export const workflows = { processOrder };
```

The generated module includes:

- **agent factory functions** that mirror the declared contract shape
- **compiled workflow IR constants** exported as `const`
- **grouped exports** named `agents` and `workflows`

Additional notes:

- Type-only imports used by contract signatures are forwarded automatically.
- Contracts and workflows are emitted in alphabetical order for deterministic output.
- Generated code is build output and should not be edited by hand.

## Agent ID Naming

Contract names are converted from PascalCase to kebab-case agent IDs:

| Contract Name   | Agent ID         |
| --------------- | ---------------- |
| `OrderService`  | `order-service`  |
| `PlayerA`       | `player-a`       |
| `FraudDetector` | `fraud-detector` |

With an instance:

```text
OrderService("legacy") -> "order-service:legacy"
OrderService()         -> "order-service"
```

## Type Import Forwarding

Contract signatures may reference imported types in parameter and return positions. The compiler resolves these against the source file's `import type` declarations and forwards the needed imports to the generated module.

Supported patterns:

```typescript
import type { Order, Receipt } from "./types.js";
import type * as T from "./types.js";
import type Config from "./config.js";
import { createOrder, type OrderInput } from "./orders.js";
```

Builtin types are recognized automatically and never need imports, including:

- `string`
- `number`
- `boolean`
- `null`
- `undefined`
- `void`
- `never`
- `any`
- `unknown`
- `object`
- `bigint`
- `symbol`
- `Record`
- `Array`
- `ReadonlyArray`
- `Promise`
- `Partial`
- `Required`
- `Readonly`
- `Pick`
- `Omit`
- `Exclude`
- `Extract`
- `ReturnType`
- `Parameters`
- `NonNullable`
- `Awaited`

Inline structural types are also supported:

```typescript
declare function OrderService(): {
  create(payload: { orderId: string; items: { sku: string; qty: number }[] }): Workflow<Order>;
};
```

In this case only `Order` needs to be imported.

Rejected patterns:

- source-local interfaces, type aliases, classes, or enums used in contracts
- unresolved type references with no matching `import type`

Supported type shapes include:

- plain type references
- namespace-qualified types
- generic types
- unions and intersections
- tuples
- array shorthand
- inline object literals

Unsupported type operators in v1 include:

- `typeof`
- `keyof`
- `readonly` (operator form)
- `unique`

Conditional and mapped types are not currently guaranteed to compile correctly.

## Restrictions and Errors

The compiler enforces a deterministic, side-effect-free subset of TypeScript. Violations produce a `CompileError` with an error code, line, and column.

### Language restrictions

| Code | Restriction                                       |
| ---- | ------------------------------------------------- |
| E002 | Use `const` instead of `var`                      |
| E003 | Reassignment of `const` binding or undeclared name is not allowed |
| E004 | Property mutation is not allowed                  |
| E005 | Computed property access is not allowed           |
| E006 | `Math.random()` is not allowed                    |
| E007 | `Date.now()` is not allowed                       |
| E008 | `Map` / `Set` constructors are not allowed        |
| E009 | `async` / `await` is not allowed                  |
| E010 | `yield*` must appear in statement position only   |
| E011 | Ambiguous `+` operator                            |
| E013 | `for...in` is not allowed; general `for...of` is not allowed outside the stream-iteration form |
| E014 | `eval()` / `new Function()` is not allowed        |
| E016 | `class` / `this` is not allowed                   |
| E033 | `return` inside a `try` / `catch` / `finally` clause is not supported |
| E034 | `catch` clause requires a binding parameter       |
| E035 | Variable assigned inside `finally` is not visible after the `try` statement |
| E017 | `yield` without `*` is not allowed                |
| E018 | Cannot call arrow function directly               |
| E019 | `typeof` / `instanceof` is not allowed            |
| E020 | `break` / `continue` is not allowed               |
| E021 | `Promise` is not allowed                          |
| E023 | Only `throw new Error(...)` is allowed            |
| E024 | Arrow functions must have expression bodies       |
| E028 | Variable names must not start with `__`           |
| E029 | `delete` operator is not allowed                  |
| E030 | `Symbol` is not allowed                           |
| E-STREAM-001 | `for...of` stream iteration requires `const`, not `let` or `var` |
| E-STREAM-002 | Destructuring in stream iteration is not supported |
| E-STREAM-003 | `for...of` with `each()` requires `yield*` |
| E-STREAM-004 | `each()` is only valid as the iterable in `for (const x of yield* each(expr))` |
| E-STREAM-005 | `each.next()` is not part of the Tisyn authored language |
| E-STREAM-006 | Nested stream-iteration loops are not supported in this version |

### Contract errors

Contract validation errors use `E999`, including:

- duplicate ambient contract declaration names
- workflow name colliding with a contract name
- contract return type not being an object type literal
- non-method members inside the contract type literal
- contract method missing `Workflow<T>` return type
- wrong number of type arguments for `Workflow`
- contract method with zero parameters in v1
- optional or rest parameters in contract methods in v1
- invalid factory parameter shape
- source-local or unresolved type references
- unsupported type operators in contract signatures

### Scope errors

| Code | Restriction                                                                           |
| ---- | ------------------------------------------------------------------------------------- |
| S0   | `scoped()` can only be used in a workflow (contract context required)                 |
| S1   | Setup statements (`useTransport`, `Effects.around`) must precede body statements      |
| S5   | Duplicate `useTransport` for the same contract in one `scoped()` block                |
| S6   | At most one `Effects.around` per `scoped()` block                                     |
| UT1  | `useTransport` first argument must be a known contract identifier                     |
| EA1  | `Effects.around` argument must have exactly one property                              |
| EA2  | `Effects.around` property must be `*dispatch([id, data], next) { ... }`              |
| UA1  | `useAgent` can only be used inside `scoped()`                                         |
| UA2  | `useAgent` argument must be a contract identifier                                     |
| UA3  | `useAgent` contract must have a matching `useTransport` in the same `scoped()` block  |
| H4   | Unknown method on handle, or wrong argument count                                     |
| SP1  | `spawn()` requires exactly one inline generator-function argument                     |
| SP2  | Spawn handle bindings must use `const`, not `let`                                    |
| SP4  | Spawn handles are join-only and cannot be used as ordinary values                    |
| SP11 | Spawned bodies do not inherit parent spawn handles                                   |
| RS1  | `resource()` requires exactly one inline generator-function argument                  |
| RS4  | Resource body must contain exactly one `provide` call                                 |
| RS7  | Nested `resource()` inside a resource body is not supported                           |
| P1   | `provide()` requires exactly one argument                                             |
| P2   | `provide()` is only valid inside a resource body                                      |
| P3   | Multiple `provide` calls in the same resource body                                    |
| P5   | `provide` must not appear inside control flow, scoped, spawn, or nested generators    |
| P6   | No code may follow `provide` at the same nesting level                                |

### Validation errors

If IR validation is enabled, malformed IR produces code `V001`.

## Public API Reference

### `generateWorkflowModule(source, options?)`

Primary API for most consumers. Discovers contracts, compiles workflows, validates IR, and generates a TypeScript module.

```typescript
interface GenerateOptions {
  filename?: string; // default: "input.ts"
  validate?: boolean; // default: true
}

interface GenerateResult {
  source: string;
  contracts: DiscoveredContract[];
  workflows: Record<string, Expr>;
}
```

Throws `CompileError` on contract violations, compilation errors, or malformed IR when validation is enabled.

### `compile(source, options?)`

Lower-level API that compiles exported generator functions to IR without contract discovery or code generation.

```typescript
interface CompileOptions {
  validate?: boolean; // default: true
  filename?: string; // default: "input.ts"
}

interface CompileResult {
  functions: Record<string, Expr>;
}
```

### `compileOne(source, options?)`

Convenience wrapper that compiles source and returns the first compiled function's IR directly.

### `toAgentId(pascalCase: string)`

Convert a PascalCase contract name into a kebab-case agent ID.

```typescript
toAgentId("OrderService"); // "order-service"
```

### `CompileError`

```typescript
class CompileError extends Error {
  code: string;   // e.g. "E001", "E999", "V001"
  line: number;
  column: number;
}
```

Message format:

```text
E001 at 3:5: Use 'const' instead of 'let'
```

### `DiscoveredContract` and `ContractMethod`

```typescript
interface DiscoveredContract {
  name: string;
  baseAgentId: string;
  hasInstance: boolean;
  methods: ContractMethod[];
}

interface ContractMethod {
  name: string;
  params: Array<{ name: string; type: string }>;
  resultType: string;
}
```

### IR builders

Re-exported for programmatic IR construction:

```typescript
Q, Ref, Fn, Let, Seq, If, While, Call, Get, Add, Sub, Mul, Div, Mod, Gt, Gte,
Lt, Lte, Eq, Neq, And, Or, Not, Neg, Construct, ArrayNode, Concat, Throw, Try,
ExternalEval, AllEval, RaceEval, ScopeEval, SpawnEval, JoinEval, ResourceEval, ProvideEval
```

## Using the Generated Module

A generated module is typically consumed by a host application:

```typescript
import { processOrder } from "./orders.generated.js";
import { execute } from "@tisyn/runtime";

const { result, journal } = yield* execute({
  ir: processOrder,
  env: { orderId: "abc-123" },
});

if (result.status === "ok") {
  console.log("Order:", result.value);
} else {
  console.error("Failed:", result.error.message);
}
```

`execute` accepts:

| Field         | Type                  | Description                                        |
| ------------- | --------------------- | -------------------------------------------------- |
| `ir`          | `Expr`                | The compiled workflow IR                           |
| `env`         | `Record<string, Val>` | Initial workflow parameter bindings                |
| `stream`      | `DurableStream`       | Durable journal stream (defaults to in-memory)     |
| `coroutineId` | `string`              | Root task ID (defaults to `"root"`)                |

It returns:

```typescript
{ result: EventResult, journal: DurableEvent[] }
```

Generated agent factories create declarations. They do not execute operations by themselves. Agent implementations must be installed before execution.

## Implementing Agents

Use `implementAgent` from `@tisyn/agent` to bind handlers to a generated declaration:

```typescript
import { implementAgent } from "@tisyn/agent";
import { OrderService } from "./orders.generated.js";

const orderAgent = implementAgent(OrderService(), {
  *fetchOrder({ orderId }) {
    const row = yield* queryDatabase("SELECT * FROM orders WHERE id = $1", [orderId]);
    return { id: row.id, items: row.items, total: row.total };
  },
});

yield* orderAgent.install();
```

For instanced agents:

```typescript
const legacyAgent = implementAgent(OrderService("legacy"), {
  *fetchOrder({ orderId }) {
    return yield* legacyApiCall(orderId);
  },
});
```

Each handler is an Effection generator function receiving typed payload and returning typed output. `install()` registers the handlers so runtime dispatch can resolve `ExternalEval` nodes for that agent.

## Package Relationships

```text
                    build time                          runtime
                   ┌──────────┐                      ┌─────────┐
authored source ──▶│ compiler │──▶ generated module ──▶│ runtime │──▶ result
                   └──────────┘         │              └─────────┘
                       uses             │                  uses
                    @tisyn/ir       imports from        @tisyn/agent
                    @tisyn/validate @tisyn/agent        @tisyn/kernel
```

- **`@tisyn/compiler`**: compile authored source into generated modules
- **`@tisyn/agent`**: provide `agent()`, `operation()`, and `implementAgent()`
- **`@tisyn/runtime`**: execute workflow IR with installed agents
- **`@tisyn/ir`**: define IR types and node shapes
- **`@tisyn/validate`**: validate structural IR correctness

## Compiler Pipeline

For contributors, `generateWorkflowModule` runs this pipeline:

1. **parse** (`src/parse.ts`) — extract generator functions from the TypeScript AST
2. **discover** (`src/discover.ts`) — find ambient contracts and extract method/type metadata
3. **emit** (`src/emit.ts`) — lower authored syntax into Tisyn IR
4. **validate** (`@tisyn/validate`) — validate IR structure
5. **codegen** (`src/codegen.ts`) — emit the generated TypeScript module

The lower-level `compile` API runs only parse, emit, and validate.

## End-to-End Example

### 1. Authored source

```typescript
// orders.workflow.ts
import type { Order } from "./types.js";
import type { Receipt } from "./billing.js";

declare function OrderService(instance?: string): {
  fetchOrder(orderId: string): Workflow<Order>;
};

declare function BillingService(): {
  charge(payload: { orderId: string; amount: number }): Workflow<Receipt>;
};

export function* fulfillOrder(orderId: string) {
  const order = yield* OrderService().fetchOrder(orderId);
  const receipt = yield* BillingService().charge({
    orderId: order.id,
    amount: order.total,
  });
  return receipt;
}
```

### 2. Compile

```typescript
import { generateWorkflowModule } from "@tisyn/compiler";
import { readFileSync, writeFileSync } from "fs";

const source = readFileSync("orders.workflow.ts", "utf-8");
const { source: generated } = generateWorkflowModule(source, {
  filename: "orders.workflow.ts",
});

writeFileSync("orders.generated.ts", generated);
```

### 3. Generated output

```typescript
// Auto-generated by @tisyn/compiler — do not edit
import { agent, operation } from "@tisyn/agent";
import type { Receipt } from "./billing.js";
import type { Order } from "./types.js";

export function BillingService() {
  const id = "billing-service";
  return agent(id, {
    charge: operation<{ payload: { orderId: string; amount: number } }, Receipt>(),
  });
}

export function OrderService(instance?: string) {
  const id = instance ? `order-service:${instance}` : "order-service";
  return agent(id, {
    fetchOrder: operation<{ orderId: string }, Order>(),
  });
}

export const fulfillOrder = {
  type: "fn",
  params: ["orderId"],
  body: {
    /* ... compiled IR ... */
  },
} as const;

export const agents = { BillingService, OrderService };
export const workflows = { fulfillOrder };
```

### 4. Execute

```typescript
import { fulfillOrder } from "./orders.generated.js";
import { execute } from "@tisyn/runtime";

const { result, journal } = yield* execute({
  ir: fulfillOrder,
  env: { orderId: "order-42" },
});

if (result.status === "ok") {
  console.log("Receipt:", result.value);
}
```

### 5. Implement agents

```typescript
import { implementAgent } from "@tisyn/agent";
import { OrderService, BillingService } from "./orders.generated.js";

const orderAgent = implementAgent(OrderService(), {
  *fetchOrder({ orderId }) {
    return yield* db.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  },
});

const billingAgent = implementAgent(BillingService(), {
  *charge({ payload }) {
    return yield* stripeApi.charge(payload.orderId, payload.amount);
  },
});

yield* orderAgent.install();
yield* billingAgent.install();
```
