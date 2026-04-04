/**
 * Integration tests for authored `yield* Config.useConfig(Token)`.
 *
 * These tests compile TypeScript workflow source containing `Config.useConfig(Token)`,
 * then execute the compiled IR via @tisyn/runtime with a resolved config
 * projection. They cover CFG-USE-001 through CFG-USE-004 and CFG-USE-009.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { Call, Ref, type Val } from "@tisyn/ir";
import { execute, resolveConfig, provideConfig } from "@tisyn/runtime";
import { compileOne } from "@tisyn/compiler";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";

const CONFIG_PREAMBLE = `
  declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
  declare const Token: ConfigToken<unknown>;
`;

describe("Config.useConfig(Token) integration", () => {
  it("CFG-USE-001: returns post-overlay config", function* () {
    // Build a descriptor with entrypoints — the "dev" entrypoint adds a server
    const descriptor = workflow({
      run: "main",
      agents: [agent("llm", transport.local("./llm.ts"))],
      journal: journal.memory(),
      entrypoints: {
        dev: entrypoint({
          server: server.websocket({ port: 3000 }),
        }),
      },
    });

    // Resolve with "dev" entrypoint — overlay merges server into the projection
    const resolved = resolveConfig(descriptor, { entrypoint: "dev" });

    // Compile a workflow that returns Config.useConfig() result
    const ir = compileOne(`
      ${CONFIG_PREAMBLE}
      function* test(): Workflow<unknown> {
        return yield* Config.useConfig(Token);
      }
    `);

    yield* provideConfig(resolved as Val);
    const { result } = yield* execute({
      ir: Call(ir),
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const cfg = result.value as Record<string, unknown>;
      // Post-overlay: server is present (from "dev" entrypoint)
      expect(cfg.server).toBeDefined();
      expect((cfg.server as any).kind).toBe("websocket");
      expect((cfg.server as any).port).toBe(3000);
      // Agents are present
      expect(cfg.agents).toBeDefined();
      expect((cfg.agents as any[])[0].id).toBe("llm");
    }
  });

  it("CFG-USE-002 + CFG-USE-003: returns post-resolution config with no EnvDescriptor nodes", function* () {
    // Build a descriptor with env() nodes
    const descriptor = workflow({
      run: "main",
      agents: [agent("llm", transport.worker(env.required("WORKER_URL")))],
      journal: journal.file(env("JOURNAL_PATH", "./default.log")),
    });

    // Resolve with env values — env nodes become concrete values
    const resolved = resolveConfig(descriptor, {
      processEnv: {
        WORKER_URL: "http://localhost:8080/worker.js",
        JOURNAL_PATH: "/tmp/test.log",
      },
    });

    const ir = compileOne(`
      ${CONFIG_PREAMBLE}
      function* test(): Workflow<unknown> {
        return yield* Config.useConfig(Token);
      }
    `);

    yield* provideConfig(resolved as Val);
    const { result } = yield* execute({
      ir: Call(ir),
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const cfg = result.value as any;

      // CFG-USE-002: env values are resolved strings
      expect(cfg.agents[0].transport.url).toBe("http://localhost:8080/worker.js");
      expect(cfg.journal.path).toBe("/tmp/test.log");

      // CFG-USE-003: no EnvDescriptor objects remain
      const json = JSON.stringify(cfg);
      expect(json).not.toContain('"tisyn_config":"env"');
    }
  });

  it("CFG-USE-004 + CFG-USE-009: invocation args remain separate from useConfig result", function* () {
    const config = { debug: true, model: "gpt-4" };

    // Compile a workflow that takes args AND calls Config.useConfig, returning both
    const ir = compileOne(`
      ${CONFIG_PREAMBLE}
      function* test(input: string): Workflow<unknown> {
        const cfg = yield* Config.useConfig(Token);
        return { cfg: cfg, input: input };
      }
    `);

    yield* provideConfig(config as Val);
    const { result } = yield* execute({
      ir: Call(ir, Ref("input")),
      env: { input: "hello-world" } as never,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const value = result.value as { cfg: unknown; input: unknown };

      // CFG-USE-004: config does not contain invocation args
      expect(value.cfg).toEqual(config);
      expect(value.cfg).not.toHaveProperty("input");

      // CFG-USE-009: invocation args delivered via function parameter, not useConfig
      expect(value.input).toBe("hello-world");
    }
  });

  it("UC1: yield* Config.useConfig() without token fails at compile time", function* () {
    expect(() =>
      compileOne(`
        declare const Config: { useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown> };
        function* test(): Workflow<unknown> {
          return yield* Config.useConfig();
        }
      `),
    ).toThrow("UC1");
  });

  it("UC3: bare yield* useConfig(Token) fails at compile time", function* () {
    expect(() =>
      compileOne(`
        declare const Token: ConfigToken<unknown>;
        function* test(): Workflow<unknown> {
          return yield* useConfig(Token);
        }
      `),
    ).toThrow("UC3");
  });
});
