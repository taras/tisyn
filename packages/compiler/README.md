# @tisyn/compiler

Compiles authored TypeScript workflow source into generated TypeScript modules containing agent declarations and portable workflow IR. The authored source combines ambient factory contract declarations (`declare function`) with exported generator functions (`function*`) that express workflow logic. The generated output can be executed by any conforming Tisyn runtime.

## Installation

```
npm install @tisyn/compiler
```

Dependencies (`@tisyn/ir`, `@tisyn/validate`, `typescript`) are regular dependencies and install automatically.

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

// result.source is the generated TypeScript module
// result.contracts describes the discovered contracts
// result.workflows contains the compiled IR by function name
```

The generated module exports factory functions for agents, compiled workflow IR, and grouped `agents`/`workflows` maps. See [Generated Output Shape](#generated-output-shape) for the full structure.

## Authoring Format — Contract Declarations

Contracts declare the external agent operations that workflows can call. They use TypeScript ambient function declarations:

```typescript
declare function ServiceName(instance?: string): {
  methodName(param: ParamType): Workflow<ResultType>;
};
```

Rules:

- **Ambient declaration**: `declare function` with no body. This is not a real function — it tells the compiler what operations exist.
- **Factory parameter**: Zero or one parameter. If present, must be `instance?: string` (optional, typed as `string`). Used for multi-tenant agent IDs.
- **Return type**: Must be an object type literal containing method signatures. Not a type reference — the methods must be inline.
- **Method return type**: Each method must return `Workflow<T>` with exactly one type argument. `T` is the result type of the operation.
- **Method parameters**: Each method must have at least one parameter (v1 restriction). Parameters must not be optional or rest parameters (v1 restriction). Each parameter must have an explicit type annotation.

Example with multiple methods:

```typescript
import type { Order, OrderUpdate, Receipt } from "./types.js";

declare function OrderService(instance?: string): {
  fetchOrder(orderId: string): Workflow<Order>;
  updateOrder(orderId: string, data: OrderUpdate): Workflow<Order>;
  refund(orderId: string, amount: number): Workflow<Receipt>;
};
```

Example without instance parameter:

```typescript
declare function ConfigService(): {
  getValue(key: string): Workflow<string>;
};
```

## Authoring Format — Workflow Functions

Workflows are exported generator functions that express orchestration logic:

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

- Must be a generator function (`function*`).
- Must be `export`ed to appear in the generated output.
- `yield*` calls to contract methods are the mechanism for invoking agent operations.
- Supported constructs: `const` declarations, `if`/`else`, `while` loops, `throw new Error(...)`, arrow functions (expression body only), object/array literals, template literals, ternary expressions.
- Non-exported generator functions are ignored.
- See [Restrictions and Error Catalog](#restrictions-and-error-catalog) for what is not allowed.

## Workflow Call Syntax and Lowering

When a workflow calls a contract method via `yield*`, the compiler lowers it to an `ExternalEval` IR node:

```typescript
// Authored
const order = yield * OrderService().fetchOrder(orderId);

// Compiles to (conceptual IR)
// ExternalEval("order-service.fetchOrder", Construct({ orderId: Ref("orderId") }))
```

**Positional-to-payload normalization**: The compiler uses the contract's parameter names to convert positional arguments into a named payload object. Given a contract method `fetchOrder(orderId: string, includeLines: boolean)`, the call `fetchOrder(id, true)` becomes `{ orderId: id, includeLines: true }`.

**Instance variant**: When the factory is called with an instance string, the agent ID includes it as a suffix:

```typescript
yield * OrderService("legacy").fetchOrder(orderId);
// Agent ID: "order-service:legacy"
// Effect ID: "order-service:legacy.fetchOrder"
```

Without an instance argument, the base agent ID is used:

```typescript
yield * OrderService().fetchOrder(orderId);
// Agent ID: "order-service"
// Effect ID: "order-service.fetchOrder"
```

The contract must be declared as a `declare function` in the same source file as the workflow that references it.

## Generated Output Shape

The compiler produces a TypeScript module with this structure:

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

**Factory functions** mirror the contract shape. Each method becomes a typed `operation<Args, Result>()` call. The factory calls `agent(id, operations)` from `@tisyn/agent`, which returns a declaration with host-side call constructors.

**Workflow IR** is exported as a `const` with `as const` assertion. The IR is a JSON-serializable tree of Tisyn expression nodes.

**Grouped exports**: `agents` collects all factory functions; `workflows` collects all compiled IR constants. Both are plain objects keyed by name.

**Type imports** referenced by contract signatures are forwarded from the source. Only `import type` declarations are forwarded — value imports are never included.

Contracts and workflows are sorted alphabetically in the output for deterministic generation.

## Agent ID Naming Convention

Contract names are converted from PascalCase to kebab-case for agent IDs:

| Contract Name   | Agent ID         |
| --------------- | ---------------- |
| `OrderService`  | `order-service`  |
| `PlayerA`       | `player-a`       |
| `FraudDetector` | `fraud-detector` |

With an instance parameter, the instance is appended after a colon:

```
OrderService("legacy") → "order-service:legacy"
OrderService()         → "order-service"
```

## Type Import Forwarding

Contract signatures reference types in their parameter and return type positions. The compiler resolves these references against the source file's `import type` declarations and forwards matching imports to the generated module.

**Supported import shapes**:

```typescript
// Named import — individual specifiers are matched
import type { Order, Receipt } from "./types.js";

// Namespace import — matched when contracts use T.Member syntax
import type * as T from "./types.js";

// Default import
import type Config from "./config.js";

// Mixed import with type specifiers — only type specifiers forwarded
import { createOrder, type OrderInput } from "./orders.js";
```

**Builtin types** are recognized automatically and never require imports: `string`, `number`, `boolean`, `null`, `undefined`, `void`, `never`, `any`, `unknown`, `object`, `bigint`, `symbol`, `Record`, `Array`, `ReadonlyArray`, `Promise`, `Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Exclude`, `Extract`, `ReturnType`, `Parameters`, `NonNullable`, `Awaited`.

**Inline structural types** in parameters work without imports:

```typescript
declare function OrderService(): {
  create(payload: { orderId: string; items: { sku: string; qty: number }[] }): Workflow<Order>;
};
```

Here, only `Order` needs an `import type` — the inline object type's property names (`orderId`, `items`, `sku`, `qty`) are not treated as type references.

**Rejected patterns**:

- **Source-local types**: Interfaces, type aliases, classes, and enums defined in the same file as the contract are rejected. Move them to a separate module and use `import type`.
- **Unresolved references**: If a contract references a type that has no corresponding `import type` in the source, compilation fails with an error indicating which type needs an import.

**Supported type shapes**: Type references (`Foo`), namespace-qualified types (`T.Foo`), generic types (`Array<Foo>`), union and intersection types, tuple types, array shorthand (`Foo[]`), and inline object literals.

**Unsupported type operators**: `typeof`, `keyof`, `readonly` (operator form), and `unique` are rejected with a `CompileError` (v1 restriction). Conditional types (`T extends U ? X : Y`) and mapped types are not currently detected and may produce incorrect output. Limit contract signatures to the supported shapes listed above.

## Restrictions and Error Catalog

The compiler enforces a deterministic, side-effect-free subset of TypeScript. Violations produce a `CompileError` with the corresponding error code, source line, and column.

### Language Restrictions

| Code | Restriction                                       |
| ---- | ------------------------------------------------- |
| E001 | Use `const` instead of `let`                      |
| E002 | Use `const` instead of `var`                      |
| E003 | Reassignment is not allowed                       |
| E004 | Property mutation is not allowed                  |
| E005 | Computed property access is not allowed           |
| E006 | `Math.random()` is not allowed (nondeterministic) |
| E007 | `Date.now()` is not allowed (nondeterministic)    |
| E008 | `Map`/`Set` constructors are not allowed          |
| E009 | `async`/`await` is not allowed                    |
| E010 | `yield*` must appear in statement position only   |
| E011 | Ambiguous `+` operator                            |
| E013 | `for...in`/`for...of` is not allowed              |
| E014 | `eval()`/`new Function()` is not allowed          |
| E015 | `try`/`catch` is not allowed                      |
| E016 | `class`/`this` is not allowed                     |
| E017 | `yield` without `*` is not allowed                |
| E018 | Cannot call arrow function directly               |
| E019 | `typeof`/`instanceof` is not allowed              |
| E020 | `break`/`continue` is not allowed                 |
| E021 | `Promise` is not allowed                          |
| E023 | Only `throw new Error(...)` is allowed            |
| E024 | Arrow functions must have expression bodies       |
| E028 | Variable names must not start with `__`           |
| E029 | `delete` operator is not allowed                  |
| E030 | `Symbol` is not allowed                           |

### Contract Errors

Contract validation errors use code `E999`:

- Duplicate ambient contract declaration names
- Workflow name collides with a contract name
- Contract return type is not an object type literal
- Contract type literal contains non-method members
- Contract method missing `Workflow<T>` return type
- `Workflow` has wrong number of type arguments (must be exactly one)
- Contract method has zero parameters (v1 restriction)
- Contract method has optional parameters (v1 restriction)
- Contract method has rest parameters (v1 restriction)
- Factory parameter is not optional or not typed as `string`
- Contract references a source-local type (must use `import type`)
- Contract references an unresolved type (no matching `import type` found)
- Contract uses `typeof`, `keyof`, `readonly`, or `unique` type operators (v1 restriction)

### Validation Errors

If IR validation is enabled (the default), malformed IR produces code `V001`.

## Public API Reference

### `generateWorkflowModule(source, options?): GenerateResult`

Primary API. Discovers contracts, compiles workflows, and generates a TypeScript module.

```typescript
interface GenerateOptions {
  filename?: string; // Source filename for error messages. Default: "input.ts"
  validate?: boolean; // Run IR validation. Default: true
}

interface GenerateResult {
  source: string; // Generated TypeScript module source
  contracts: DiscoveredContract[]; // Discovered ambient contracts
  workflows: Record<string, Expr>; // Compiled workflow IR by name
}
```

Throws `CompileError` on contract violations, compilation errors, or (with validation enabled) malformed IR.

### `compile(source, options?): CompileResult`

Lower-level API. Compiles generator functions to IR without contract discovery or codegen. Does not process `declare function` contracts or generate module source.

```typescript
interface CompileOptions {
  validate?: boolean; // Default: true
  filename?: string; // Default: "input.ts"
}

interface CompileResult {
  functions: Record<string, Expr>; // Compiled IR by function name
}
```

### `compileOne(source, options?): Expr`

Convenience wrapper. Compiles source and returns the first function's IR directly.

### `toAgentId(pascalCase: string): string`

Converts a PascalCase name to a kebab-case agent ID. `"OrderService"` → `"order-service"`.

### `CompileError`

Error class with structured fields:

```typescript
class CompileError extends Error {
  code: string; // e.g. "E001", "E999", "V001"
  line: number;
  column: number;
  // message format: "E001 at 3:5: Use 'const' instead of 'let'"
}
```

### `DiscoveredContract` / `ContractMethod`

```typescript
interface DiscoveredContract {
  name: string; // e.g. "OrderService"
  baseAgentId: string; // e.g. "order-service"
  hasInstance: boolean; // true if factory accepts instance?: string
  methods: ContractMethod[];
}

interface ContractMethod {
  name: string; // e.g. "fetchOrder"
  params: Array<{ name: string; type: string }>;
  resultType: string; // e.g. "Order"
}
```

### IR Builders

Re-exported for programmatic IR construction: `Q`, `Ref`, `Fn`, `Let`, `Seq`, `If`, `While`, `Call`, `Get`, `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Gt`, `Gte`, `Lt`, `Lte`, `Eq`, `Neq`, `And`, `Or`, `Not`, `Neg`, `Construct`, `ArrayNode`, `Concat`, `Throw`, `ExternalEval`, `AllEval`, `RaceEval`.

## Using the Generated Module — Host Side

The generated module is used by a host application to execute workflows:

```typescript
import { processOrder } from "./orders.generated.js";
import { execute } from "@tisyn/runtime";

const { result, journal } =
  yield *
  execute({
    ir: processOrder,
    env: { orderId: "abc-123" },
  });

if (result.status === "ok") {
  console.log("Order:", result.value);
} else {
  console.error("Failed:", result.error.message);
}
```

`execute` accepts an options object:

| Field         | Type                  | Description                                        |
| ------------- | --------------------- | -------------------------------------------------- |
| `ir`          | `Expr`                | The compiled workflow IR                           |
| `env`         | `Record<string, Val>` | Initial environment bindings (workflow parameters) |
| `stream`      | `DurableStream`       | Durable stream for journaling (default: in-memory) |
| `coroutineId` | `string`              | Root task ID (default: `"root"`)                   |

Returns `{ result: EventResult, journal: DurableEvent[] }`.

The generated factory functions create agent declarations — they do not execute operations. You must provide agent implementations and install them before calling `execute`.

## Implementing Agents

Use `implementAgent` from `@tisyn/agent` to bind operation handlers to a declaration:

```typescript
import { implementAgent } from "@tisyn/agent";
import { OrderService } from "./orders.generated.js";

const orderAgent = implementAgent(OrderService(), {
  *fetchOrder({ orderId }) {
    const row = yield* queryDatabase("SELECT * FROM orders WHERE id = $1", [orderId]);
    return { id: row.id, items: row.items, total: row.total };
  },
});

// Install the agent's dispatch middleware
yield * orderAgent.install();
```

Each handler is an Effection generator function that receives the typed payload and returns the typed result. The `install()` method registers the agent's handlers as dispatch middleware — when a workflow executes an `ExternalEval` for this agent, the corresponding handler runs.

For instanced agents, pass the instance to the factory:

```typescript
const legacyAgent = implementAgent(OrderService("legacy"), {
  *fetchOrder({ orderId }) {
    return yield* legacyApiCall(orderId);
  },
});
```

## Package Relationships

```
                    build time                          runtime
                   ┌──────────┐                      ┌─────────┐
authored source ──▸│ compiler │──▸ generated module ──▸│ runtime │──▸ result
                   └──────────┘         │              └─────────┘
                       uses             │                  uses
                    @tisyn/ir       imports from        @tisyn/agent
                    @tisyn/validate @tisyn/agent        @tisyn/kernel
```

- **@tisyn/compiler** — compiles authored source into a generated module (build time)
- **@tisyn/agent** — provides `agent()`, `operation()`, `implementAgent()` (used by generated code and host)
- **@tisyn/runtime** — executes workflow IR with installed agent implementations (runtime)
- **@tisyn/ir** — IR type definitions (`TisynExpr`)
- **@tisyn/validate** — IR structural validation (`assertValidIr`)

## Compiler Pipeline Internals

For contributors. The `generateWorkflowModule` pipeline:

1. **Parse** (`src/parse.ts`) — extract generator functions from the TypeScript AST
2. **Discover** (`src/discover.ts`) — find ambient `declare function` contracts, extract method signatures and type nodes
3. **Emit** (`src/emit.ts`) — compile TypeScript AST nodes into Tisyn IR. Contract-aware: `yield*` calls to discovered contracts become `ExternalEval` nodes with positional-to-payload normalization
4. **Validate** (`@tisyn/validate`) — structural IR validation (optional, enabled by default)
5. **Codegen** (`src/codegen.ts`) — generate TypeScript module source with factory functions, IR exports, and grouped maps

The lower-level `compile` API runs steps 1, 3, and 4 only (no discovery or codegen).

## Full End-to-End Example

### 1. Authored Source

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

### 3. Generated Output

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

### 4. Host-Side Usage

```typescript
import { fulfillOrder } from "./orders.generated.js";
import { execute } from "@tisyn/runtime";

const { result, journal } =
  yield *
  execute({
    ir: fulfillOrder,
    env: { orderId: "order-42" },
  });

if (result.status === "ok") {
  console.log("Receipt:", result.value);
}
```

### 5. Agent Implementations

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

yield * orderAgent.install();
yield * billingAgent.install();
```
