/**
 * Tests for ConfigToken<T>, configToken<T>(), and useConfig<T>().
 *
 * The type-level assertions use @ts-expect-error to verify that
 * yield* useConfig(Token) returns the token's T at compile time.
 */

import { describe, it, expect } from "vitest";
import { configToken, useConfig } from "./index.js";

describe("configToken", () => {
  it("returns an object", () => {
    const token = configToken<{ debug: boolean }>();
    expect(token).toBeDefined();
    expect(typeof token).toBe("object");
  });
});

describe("useConfig (direct invocation)", () => {
  it("throws when called outside the compiler", () => {
    const token = configToken<{ debug: boolean }>();
    const gen = useConfig(token);
    expect(() => gen.next()).toThrow("must be compiled by the Tisyn compiler");
  });
});

describe("useConfig type-level", () => {
  it("yield* useConfig(Token) returns T", () => {
    type AppConfig = { debug: boolean; model: string };
    const AppToken = configToken<AppConfig>();

    // This generator is never executed — it only verifies type inference.
    function* _typeTest(): Generator<unknown, void, unknown> {
      const cfg = yield* useConfig(AppToken);

      // Should type-check:
      const _d: boolean = cfg.debug;
      const _m: string = cfg.model;

      // @ts-expect-error — property does not exist on AppConfig
      void cfg.nonExistent;

      // @ts-expect-error — wrong type: debug is boolean, not number
      const _x: number = cfg.debug;

      void [_d, _m, _x];
    }

    // If the above compiles, the type-level contract holds.
    expect(true).toBe(true);
  });
});
