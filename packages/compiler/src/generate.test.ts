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
    const contracts = discoverContracts(sf);
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
    const contracts = discoverContracts(sf);
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
    const contracts = discoverContracts(sf);
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
    const contracts = discoverContracts(sf);
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
    const contracts = discoverContracts(sf);
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
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("Order");
    expect(imports[0]).not.toContain("Unused");
    expect(imports[0]).not.toContain("Receipt");
  });

  it("does not forward value imports", () => {
    const sf = parseSource(`
      import { Order } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(0);
  });

  it("collects type-only specifiers from mixed imports", () => {
    const sf = parseSource(`
      import { type Order, doSomething } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
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
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(0);
  });

  it("returns empty array when no contracts", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
    `);
    const imports = collectReferencedTypeImports(sf, []);
    expect(imports).toHaveLength(0);
  });

  it("extracts type identifiers from composite types like Record<string, Order>", () => {
    const sf = parseSource(`
      import type { Order } from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Record<string, Order>>;
      };
    `);
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
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
    const contracts = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contracts)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contracts)).toThrow(/source-local type 'Order'/);
  });

  it("rejects source-local type alias types with clear error", () => {
    const sf = parseSource(`
      type Receipt = { amount: number };
      declare function PaymentService(): {
        charge(amount: number): Workflow<Receipt>;
      };
    `);
    const contracts = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contracts)).toThrow(
      /source-local type 'Receipt'/,
    );
  });

  it("allows ambient types not found in imports or local declarations", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<Order>;
      };
    `);
    const contracts = discoverContracts(sf);
    // Order is neither imported nor locally defined — assumed ambient
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(0);
  });

  it("forwards namespace imports for qualified types like T.Order", () => {
    const sf = parseSource(`
      import type * as T from "./types.js";
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<T.Order>;
      };
    `);
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
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
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("* as T");
  });

  it("rejects unresolved namespace qualifiers", () => {
    const sf = parseSource(`
      declare function OrderService(): {
        fetchOrder(orderId: string): Workflow<T.Order>;
      };
    `);
    const contracts = discoverContracts(sf);
    expect(() => collectReferencedTypeImports(sf, contracts)).toThrow(CompileError);
    expect(() => collectReferencedTypeImports(sf, contracts)).toThrow(
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
    const contracts = discoverContracts(sf);
    const imports = collectReferencedTypeImports(sf, contracts);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toBe('import type { Original as Aliased } from "./types.js";');
  });
});

// ── generateWorkflowModule ──

describe("generateWorkflowModule", () => {
  // ── Instance handling ──

  describe("instance handling", () => {
    it("compiles default factory call (no instance) with base agent ID", () => {
      const source = `
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
      expect(result.source).toContain("export const processOrder =");
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
  });

  // ── Metadata ──

  describe("result metadata", () => {
    it("returns discovered contracts", () => {
      const source = `
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
