/**
 * Integration tests for authored `yield* useConfig(Token)`.
 *
 * These tests compile TypeScript workflow source containing `useConfig(Token)`,
 * then execute the compiled IR via @tisyn/runtime with a resolved config
 * projection. They cover CFG-USE-001 through CFG-USE-004 and CFG-USE-009.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { Call, Ref } from "@tisyn/ir";
import { execute, resolveConfig } from "@tisyn/runtime";
import { compileOne } from "@tisyn/compiler";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";

describe("useConfig(Token) integration", () => {
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

    // Compile a workflow that returns useConfig() result
    const ir = compileOne(`
      declare const Token: ConfigToken<unknown>;
      function* test(): Workflow<unknown> {
        return yield* useConfig(Token);
      }
    `);

    const { result } = yield* execute({
      ir: Call(ir),
      config: resolved as unknown as Record<string, unknown>,
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
      declare const Token: ConfigToken<unknown>;
      function* test(): Workflow<unknown> {
        return yield* useConfig(Token);
      }
    `);

    const { result } = yield* execute({
      ir: Call(ir),
      config: resolved as unknown as Record<string, unknown>,
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

    // Compile a workflow that takes args AND calls useConfig, returning both
    const ir = compileOne(`
      declare const Token: ConfigToken<unknown>;
      function* test(input: string): Workflow<unknown> {
        const cfg = yield* useConfig(Token);
        return { cfg: cfg, input: input };
      }
    `);

    const { result } = yield* execute({
      ir: Call(ir, Ref("input")),
      env: { input: "hello-world" } as never,
      config: config as Record<string, unknown>,
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

  it("UC1: yield* useConfig() without token fails at compile time", function* () {
    expect(() =>
      compileOne(`
        function* test(): Workflow<unknown> {
          return yield* useConfig();
        }
      `),
    ).toThrow("UC1");
  });
});
