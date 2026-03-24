/**
 * Tests for generateWorkflowModule and supporting modules.
 *
 * Covers: discovery, instance handling, normalization,
 * validation errors, codegen output, and end-to-end roundtrip.
 */

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { generateWorkflowModule, CompileError } from "./index.js";
import { discoverContracts, collectReferencedTypeImports } from "./discover.js";

// ── Helpers ──

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// ── Contract Discovery ──

describe("discoverContracts", () => {
  it("discovers ambient factory contract with instance param", () => {
    const sf = parseSource(`
      declare function OrderService(instance?: string): {
        fetchOrder(orderId: string, includeLines: boolean): Workflow<Order>;
      };
    `);
    const { contracts } = discoverContracts(sf);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      name: "OrderService",
      baseAgentId: "order-service",
      hasInstance: true,
      methods: [
        {
          name: "fetchOrder",
          params: [
            { name: "orderId", type: "string" },
            { name: "includeLines", type: "boolean" },
          ],
          resultType: "Order",
        },
      ],
    });
  });

  it("discovers contract without instance param", () => {
    const sf = parseSource(`
      declare function ConfigService(): {
        getConfig(key: string): Workflow<Config>;
      };
    `);
    const { contracts } = discoverContracts(sf);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      name: "ConfigService",
      baseAgentId: "config-service",
      hasInstance: false,
    });
  });

  it("discovers multiple contracts", () => {
    const sf = parseSource(`
      declare function OrderService(instance?: string): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
      declare function PaymentService(): {
        chargeCard(payment: Payment): Workflow<Receipt>;
      };
    `);
    const { contracts } = discoverContracts(sf);
    expect(contracts).toHaveLength(2);
    expect(contracts.map((c) => c.name)).toEqual(["OrderService", "PaymentService"]);
  });

  it("extracts multiple methods from a contract", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
        updateOrder(orderId: string, data: OrderUpdate): Workflow<Order>;
      };
    `);
    const { contracts } = discoverContracts(sf);
    expect(contracts[0]!.methods).toHaveLength(2);
    expect(contracts[0]!.methods[0]!.name).toBe("fetchOrder");
    expect(contracts[0]!.methods[1]!.name).toBe("updateOrder");
    expect(contracts[0]!.methods[1]!.params).toHaveLength(2);
  });

  it("ignores non-ambient function declarations (generators)", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
      function* processOrder(orderId: string): Workflow<Receipt> {
        return orderId;
      }
    `);
    const { contracts } = discoverContracts(sf);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.name).toBe("OrderService");
  });

  it("rejects duplicate contract names", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/Duplicate/);
  });

  it("rejects factory with non-optional parameter", () => {
    const sf = parseSource(`
      declare function OrderService(instance: string): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/optional/);
  });

  it("rejects factory with more than one parameter", () => {
    const sf = parseSource(`
      declare function OrderService(a?: string, b?: string): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/zero or one/);
  });

  it("rejects method without Workflow return type", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Promise<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/Workflow<T>/);
  });

  it("rejects zero-arg contract methods", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        getAll(): Workflow<Order[]>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/at least one parameter/);
  });

  it("rejects method without return type annotation", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string);
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/Workflow<T> return type/);
  });

  it("rejects untyped optional instance parameter", () => {
    const sf = parseSource(`
      declare function OrderService(instance?): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/type annotation/);
  });

  it("rejects optional method parameter", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId?: string): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/must not be optional/);
  });

  it("rejects rest method parameter", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(...ids: string[]): Workflow<Order>;
      };
    `);
    expect(() => discoverContracts(sf)).toThrow(CompileError);
    expect(() => discoverContracts(sf)).toThrow(/must not be a rest parameter/);
  });
});

// ── Type Import Collection ──

describe("collectReferencedTypeImports", () => {
  it("collects type-only imports referenced by contracts", () => {
    const sf = parseSource(`
      import type { Order, Receipt } from "./types.js";
      import type { Unused } from "./other.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
    expect(imports[0]).not.toContain("Unused");
    expect(imports[0]).not.toContain("Receipt");
  });

  it("rejects types only available as value imports", () => {
    const sf = parseSource(`
      import { Order } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /Contract references type 'Order'.*import type/,
    );
  });

  it("collects type-only specifiers from mixed imports", () => {
    const sf = parseSource(`
      import { type Order, doSomething } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
    expect(imports[0]).not.toContain("doSomething");
  });

  it("skips primitive types", () => {
    const sf = parseSource(`
      import type { SomeType } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<string>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(0);
  });

  it("returns empty array when no contracts", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
    `);
    const imports = collectReferencedTypeImports(sf, []);
    expect(imports).toHaveLength(0);
  });

  it("accepts ReadonlyArray as a built-in type without import", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
      declare function OrderService(): {
        list(seed: string): Workflow<ReadonlyArray<Order>>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
    expect(imports[0]).not.toContain("ReadonlyArray");
  });

  it("accepts inline object types without treating property names as type references", () => {
    const sf = parseSource(`
      import type { Result } from "./types.js";
      declare function OrderService(): {
        process(payload: { orderId: string; nested: { ok: boolean } }): Workflow<Result>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Result");
  });

  it("handles array shorthand syntax in contract types", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
      declare function OrderService(): {
        list(seed: string): Workflow<Order[]>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
  });

  it("extracts type identifiers from composite types like Record<string, Order>", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Record<string, Order>>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
  });

  it("rejects source-local interface types with clear error", () => {
    const sf = parseSource(`
      interface Order { id: string; }
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /source-local type 'Order'/,
    );
  });

  it("rejects source-local type alias types with clear error", () => {
    const sf = parseSource(`
      type Receipt = { amount: number };
      declare function PaymentService(): {
        charge(amount: number): Workflow<Receipt>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /source-local type 'Receipt'/,
    );
  });

  it("rejects source-local class used in contract type", () => {
    const sf = parseSource(`
      class Order { id!: string; }
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /source-local type 'Order'/,
    );
  });

  it("rejects source-local enum used in contract type", () => {
    const sf = parseSource(`
      enum Status { Pending, Complete }
      declare function OrderService(): {
        getStatus(orderId: string): Workflow<Status>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /source-local type 'Status'/,
    );
  });

  it("forwards default type imports", () => {
    const sf = parseSource(`
      import type Order from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toBe('import type Order from "./types.js";');
  });

  it("rejects unresolved type references with no import", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /Contract references type 'Order'.*import type/,
    );
  });

  it("rejects global type Date without explicit import", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        getCreatedAt(orderId: string): Workflow<Date>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(/import type/);
  });

  it("rejects global type Uint8Array without explicit import", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        getData(orderId: string): Workflow<Uint8Array>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(/import type/);
  });

  it("rejects partially resolved types when some imports are present", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Record<string, Order>>;
        chargeCard(payment: Payment): Workflow<Receipt>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(/import type/);
  });

  it("forwards namespace imports for qualified types like T.Order", () => {
    const sf = parseSource(`
      import type * as T from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<T.Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toBe('import type * as T from "./types.js";');
  });

  it("forwards namespace imports for qualified types in composite types", () => {
    const sf = parseSource(`
      import type * as T from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Record<string, T.Order>>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("* as T");
  });

  it("rejects unresolved namespace qualifiers", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<T.Order>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contractTypeNodes)).toThrow(
      /namespace-qualified type 'T\.\*'.*import type \* as T/,
    );
  });

  it("preserves aliases in forwarded imports", () => {
    const sf = parseSource(`
      import type { Original as Aliased } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Aliased>;
      };
    `);
    const { contractTypeNodes } = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contractTypeNodes);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toBe('import type { Original as Aliased } from "./types.js";');
  });
});

// ── Type Operator Rejection ──

describe("type operator rejection in contracts", () => {
  it("rejects typeof in contract return type", () => {
    expect(() =>
      generateWorkflowModule(`
        declare function Svc(): {
          get(key: string): Workflow<typeof Config>;
        };
      `),
    ).toThrow(/typeof.*not supported/);
  });

  it("rejects keyof in contract parameter type", () => {
    expect(() =>
      generateWorkflowModule(`
        declare function Svc(): {
          get(key: keyof Config): Workflow<string>;
        };
      `),
    ).toThrow(/keyof.*not supported/);
  });

  it("rejects keyof typeof in contract return type", () => {
    expect(() =>
      generateWorkflowModule(`
        declare function Svc(): {
          get(key: string): Workflow<keyof typeof Config>;
        };
      `),
    ).toThrow(/keyof.*not supported/);
  });

  it("rejects typeof in contract parameter type", () => {
    expect(() =>
      generateWorkflowModule(`
        declare function Svc(): {
          get(opts: typeof defaults): Workflow<string>;
        };
      `),
    ).toThrow(/typeof.*not supported/);
  });

  it("rejects readonly type operator in contract parameter type", () => {
    expect(() =>
      generateWorkflowModule(`
        declare function Svc(): {
          get(ids: readonly string[]): Workflow<string>;
        };
      `),
    ).toThrow(/readonly.*not supported/);
  });
});

// ── generateWorkflowModule ──

describe("generateWorkflowModule", () => {
  // ── Instance handling ──

  describe("instance handling", () => {
    it("compiles default factory call (no instance) with base agent ID", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(instance?: string): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });

      // Check IR for correct effect ID
      const ir = result.workflows["processOrder"]!;
      const body = (ir as any).body;
      const letNode = body.data.expr;
      const evalNode = letNode.value;
      expect(evalNode.id).toBe("order-service.fetchOrder");
    });

    it("compiles instance factory call with suffixed agent ID", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(instance?: string): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService("legacy").fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });

      const ir = result.workflows["processOrder"]!;
      const body = (ir as any).body;
      const letNode = body.data.expr;
      const evalNode = letNode.value;
      expect(evalNode.id).toBe("order-service:legacy.fetchOrder");
    });

    it("rejects variable instance argument", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(instance?: string): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const inst = "legacy";
          const order = yield* OrderService(inst).fetchOrder(orderId);
          return order;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(CompileError);
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(/string literal/);
    });

    it("rejects multiple factory arguments", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(instance?: string): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService("a", "b").fetchOrder(orderId);
          return order;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(CompileError);
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(/at most one/);
    });
  });

  // ── Normalization ──

  describe("normalization", () => {
    it("normalizes single positional arg to named payload Construct", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const ir = result.workflows["processOrder"]!;
      const body = (ir as any).body;
      const evalNode = body.data.expr.value;

      // Data should be a Construct node, not an array
      expect(evalNode.data).toHaveProperty("tisyn", "eval");
      expect(evalNode.data).toHaveProperty("id", "construct");
      // The construct should have the named field
      const constructFields = evalNode.data.data.expr;
      expect(constructFields).toHaveProperty("orderId");
      expect(constructFields.orderId).toEqual({
        tisyn: "ref",
        name: "orderId",
      });
    });

    it("normalizes multi-arg to named payload Construct", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string, includeLines: boolean): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId, true);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const ir = result.workflows["processOrder"]!;
      const body = (ir as any).body;
      const evalNode = body.data.expr.value;

      const constructFields = evalNode.data.data.expr;
      expect(constructFields).toHaveProperty("orderId");
      expect(constructFields).toHaveProperty("includeLines");
      expect(constructFields.includeLines).toBe(true);
    });
  });

  // ── Validation errors ──

  describe("validation errors", () => {
    it("rejects unknown contract symbol", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const result = yield* UnknownService().doSomething(orderId);
          return result;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(
        /Unknown contract.*UnknownService/,
      );
    });

    it("rejects unknown method on known contract", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const result = yield* OrderService().unknownMethod(orderId);
          return result;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(
        /Unknown method.*unknownMethod/,
      );
    });

    it("rejects wrong arity", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string, includeLines: boolean): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(
        /expects 2 argument.*got 1/,
      );
    });

    it("rejects workflow name that collides with contract name", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* OrderService(orderId: string) {
          return orderId;
        }
      `;
      expect(() => generateWorkflowModule(source, { validate: false })).toThrow(
        /collides with contract name/,
      );
    });
  });

  // ── Codegen output ──

  describe("codegen output", () => {
    const source = `
      import type { Order, Payment, Receipt } from "./types.js";
      declare function OrderService(instance?: string): {
        fetchOrder(orderId: string, includeLines: boolean): Workflow<Order>;
      };
      declare function PaymentService(): {
        chargeCard(payment: Payment): Workflow<Receipt>;
      };
      export function* processOrder(orderId: string) {
        const order = yield* OrderService("legacy").fetchOrder(orderId, true);
        return yield* PaymentService().chargeCard(order.payment);
      }
    `;

    it("generates valid TypeScript with factory exports", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain('import { agent, operation } from "@tisyn/agent"');
      expect(result.source).toContain("export function OrderService(instance?: string)");
      expect(result.source).toContain("export function PaymentService()");
    });

    it("generates instance-aware factory for contracts with hasInstance", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain("`order-service:${instance}`");
    });

    it("generates static ID for contracts without instance", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain('"payment-service"');
    });

    it("generates operation<> with correct payload types", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain(
        "operation<{ orderId: string; includeLines: boolean }, Order>()",
      );
      expect(result.source).toContain("operation<{ payment: Payment }, Receipt>()");
    });

    it("generates named workflow IR export", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain("export const processOrder: TisynFn<");
    });

    it("generates grouped agents and workflows exports", () => {
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain("export const agents = { OrderService, PaymentService }");
      expect(result.source).toContain("export const workflows = { processOrder }");
    });

    it("produces deterministic output", () => {
      const result1 = generateWorkflowModule(source, { validate: false });
      const result2 = generateWorkflowModule(source, { validate: false });
      expect(result1.source).toBe(result2.source);
    });

    it("sorts contract exports alphabetically", () => {
      const result = generateWorkflowModule(source, { validate: false });
      const orderIdx = result.source.indexOf("export function OrderService");
      const paymentIdx = result.source.indexOf("export function PaymentService");
      expect(orderIdx).toBeLessThan(paymentIdx);
    });

    it("generated source parses without TypeScript syntax errors", () => {
      const result = generateWorkflowModule(source, { validate: false });
      const sf = ts.createSourceFile(
        "generated.ts",
        result.source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      // parseDiagnostics is not part of the public API but accessible
      const diagnostics = (sf as any).parseDiagnostics ?? [];
      expect(diagnostics).toHaveLength(0);
    });
  });

  // ── Type imports in generated output ──

  describe("type imports", () => {
    it("forwards referenced type imports to generated output", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain('import type { Order } from "./types.js"');
    });

    it("does not forward unreferenced type imports", () => {
      const source = `
        import type { Order, Unused } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain("Order");
      expect(result.source).not.toContain("Unused");
    });

    it("forwards default type imports to generated output", () => {
      const source = `
        import type Order from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.source).toContain('import type Order from "./types.js"');
    });
  });

  // ── Semantic type-check validation ──

  describe("semantic type-check", () => {
    /** Create an in-memory TS program and return semantic diagnostics for the generated file. */
    function getSemanticDiagnostics(generatedSource: string, extraFiles?: Record<string, string>, extraCompilerOptions?: ts.CompilerOptions) {
      const files: Record<string, string> = {
        "/generated.ts": generatedSource,
        // Minimal @tisyn/agent stub
        "/node_modules/@tisyn/agent/package.json": JSON.stringify({
          name: "@tisyn/agent",
          types: "./index.d.ts",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "/node_modules/@tisyn/agent/index.d.ts": `
          export interface OperationSpec<Args = unknown, Result = unknown> {
            readonly __args?: Args;
            readonly __result?: Result;
          }
          export interface AgentDeclaration<Ops extends Record<string, OperationSpec>> {
            readonly id: string;
            readonly operations: Ops;
          }
          export type AgentCalls<D extends AgentDeclaration<Record<string, OperationSpec>>> = {
            [K in keyof D["operations"]]: any;
          };
          export type DeclaredAgent<Ops extends Record<string, OperationSpec>> =
            AgentDeclaration<Ops> & AgentCalls<AgentDeclaration<Ops>>;
          export declare function agent<const Ops extends Record<string, OperationSpec<any, any>>>(
            id: string, ops: Ops
          ): DeclaredAgent<Ops>;
          export declare function operation<Args = void, Result = void>(): OperationSpec<Args, Result>;
        `,
        // Minimal @tisyn/ir stub
        "/node_modules/@tisyn/ir/package.json": JSON.stringify({
          name: "@tisyn/ir",
          types: "./index.d.ts",
          exports: { ".": { types: "./index.d.ts" } },
        }),
        "/node_modules/@tisyn/ir/index.d.ts": `
          export type Expr<T> = T | Eval<T> | TisynFn<any[], T>;
          export interface Eval<T, TData = unknown> {
            readonly tisyn: "eval";
            readonly id: string;
            readonly data: TData;
            readonly T?: T;
          }
          export interface TisynFn<A extends unknown[], R> {
            readonly tisyn: "fn";
            readonly params: readonly string[];
            readonly body: Expr<R>;
            readonly T?: (...args: A) => R;
          }
          export declare function Call<A extends unknown[], R>(
            fn: Expr<(...args: A) => R> | TisynFn<A, R>,
            ...args: { [K in keyof A]: Expr<A[K]> }
          ): Eval<R>;
        `,
        ...extraFiles,
      };

      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: false,
        noEmit: true,
        skipLibCheck: true,
        ...extraCompilerOptions,
      };

      const host = ts.createCompilerHost(compilerOptions);
      const originalGetSourceFile = host.getSourceFile.bind(host);
      const originalFileExists = host.fileExists.bind(host);
      const originalReadFile = host.readFile.bind(host);
      const originalDirectoryExists = host.directoryExists?.bind(host);
      host.getSourceFile = (fileName, languageVersion) => {
        const content = files[fileName];
        if (content !== undefined) {
          return ts.createSourceFile(fileName, content, languageVersion);
        }
        return originalGetSourceFile(fileName, languageVersion);
      };
      host.fileExists = (fileName) => fileName in files || originalFileExists(fileName);
      host.readFile = (fileName) =>
        fileName in files ? files[fileName] : originalReadFile(fileName);
      host.directoryExists = (dirName) => {
        // Check if any virtual file starts with this directory
        const prefix = dirName.endsWith("/") ? dirName : dirName + "/";
        for (const key of Object.keys(files)) {
          if (key.startsWith(prefix)) return true;
        }
        return originalDirectoryExists?.(dirName) ?? false;
      };

      const program = ts.createProgram(["/generated.ts"], compilerOptions, host);
      const semanticDiagnostics = program.getSemanticDiagnostics(program.getSourceFile("/generated.ts"));

      // When declaration emit is enabled, also run emit to catch TS2742-style errors
      if (compilerOptions.declaration) {
        host.writeFile = () => {};  // no-op — we only care about diagnostics
        const emitResult = program.emit(program.getSourceFile("/generated.ts"));
        return [...semanticDiagnostics, ...emitResult.diagnostics];
      }

      return semanticDiagnostics;
    }

    it("generated module with named type import has zero semantic errors", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const diagnostics = getSemanticDiagnostics(result.source, {
        "/types.d.ts": "export interface Order { id: string; }",
      });
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
      expect(errors).toHaveLength(0);
    });

    it("generated module with namespace type import has zero semantic errors", () => {
      const source = `
        import type * as T from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<T.Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const diagnostics = getSemanticDiagnostics(result.source, {
        "/types.d.ts": "export interface Order { id: string; }",
      });
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
      expect(errors).toHaveLength(0);
    });

    it("generated module with default type import has zero semantic errors", () => {
      const source = `
        import type Order from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const diagnostics = getSemanticDiagnostics(result.source, {
        "/types.d.ts": "export default interface Order { id: string; }",
      });
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
      expect(errors).toHaveLength(0);
    });

    it("generated module emits declarations without TS2742", () => {
      const source = `
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<{ id: string }>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const diagnostics = getSemanticDiagnostics(result.source, {}, {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
      });
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
      expect(errors).toHaveLength(0);
    });

    it("Call(workflow) type-checks without cast", () => {
      const source = `
        export function* greet() {
          return "hello";
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      const consumer = `
        import { greet } from "./generated.js";
        import { Call } from "@tisyn/ir";
        const expr = Call(greet);
      `;
      const diagnostics = getSemanticDiagnostics(consumer, {
        "/generated.ts": result.source,
      });
      const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
      expect(errors).toHaveLength(0);
    });
  });

  // ── Metadata ──

  describe("result metadata", () => {
    it("returns discovered contracts", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0]!.name).toBe("OrderService");
    });

    it("returns compiled workflows", () => {
      const source = `
        import type { Order } from "./types.js";
        declare function OrderService(): {
          fetchOrder(orderId: string): Workflow<Order>;
        };
        export function* processOrder(orderId: string) {
          const order = yield* OrderService().fetchOrder(orderId);
          return order;
        }
      `;
      const result = generateWorkflowModule(source, { validate: false });
      expect(result.workflows).toHaveProperty("processOrder");
      expect(result.workflows["processOrder"]).toHaveProperty("tisyn", "fn");
    });
  });
});
