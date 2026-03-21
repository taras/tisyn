import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { agent, operation, implementAgent, invoke } from "@tisyn/agent";
import { execute } from "./execute.js";
import { executeRemote } from "./execute-remote.js";
import type { Json } from "@tisyn/ir";

describe("Over the wire", () => {
  describe("Path A: Named business operations", () => {
    it("shopify.createOrder dispatches through graphql.execute", function* () {
      const graphql = agent("graphql", {
        execute: operation<{ document: string; variables?: Record<string, Json> }, Json>(),
      });

      const shopify = agent("shopify", {
        createOrder: operation<
          { customerId: string; lineItems: Array<{ sku: string; quantity: number }> },
          Json
        >(),
      });

      // Install GraphQL capability (mock)
      const graphqlImpl = implementAgent(graphql, {
        // biome-ignore lint/correctness/useYield: mock
        *execute({ document, variables }) {
          return { orderId: "order-1", status: "created", input: variables ?? null };
        },
      });
      yield* graphqlImpl.install();

      // Install shopify agent that uses GraphQL internally
      const shopifyImpl = implementAgent(shopify, {
        *createOrder(input) {
          return yield* invoke(
            graphql.execute({
              document:
                "mutation CreateOrder($input: CreateOrderInput!) { createOrder(input: $input) { orderId status } }",
              variables: { input },
            }),
          );
        },
      });
      yield* shopifyImpl.install();

      // Simulate receiving invocation from wire and dispatching it
      const invocation = shopify.createOrder({
        customerId: "123",
        lineItems: [{ sku: "ABC", quantity: 2 }],
      });
      const result = yield* invoke(invocation);

      expect(result).toEqual({
        orderId: "order-1",
        status: "created",
        input: {
          input: {
            customerId: "123",
            lineItems: [{ sku: "ABC", quantity: 2 }],
          },
        },
      });
    });
  });

  describe("Path B: Remote Tisyn execution", () => {
    it("proxy.run executes received IR with local dispatch", function* () {
      const math = agent("math", {
        double: operation<{ value: number }, number>(),
      });

      const mathImpl = implementAgent(math, {
        *double({ value }) {
          return value * 2;
        },
      });
      yield* mathImpl.install();

      // IR: math.double({ value: 21 })
      const program = {
        tisyn: "eval",
        id: "math.double",
        data: { value: 21 },
      };

      const result = yield* executeRemote({ program: program as never });
      expect(result).toBe(42);
    });

    it("proxy.run propagates errors with cause", function* () {
      // No agents installed — dispatch will throw for any effect

      const program = {
        tisyn: "eval",
        id: "unknown.op",
        data: [],
      };

      try {
        yield* executeRemote({ program: program as never });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;
        expect(err.message).toBeTruthy();
        // cause preserves the full EventResult
        expect(err.cause).toBeDefined();
        expect((err.cause as { status: string }).status).toBe("err");
      }
    });

    it("proxy.run passes env to execution", function* () {
      // IR: ref to env variable "x"
      const program = {
        tisyn: "ref",
        name: "x",
      };

      const result = yield* executeRemote({
        program: program as never,
        env: { x: 99 },
      });
      expect(result).toBe(99);
    });
  });
});
