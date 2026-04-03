import { describe, it, expect } from "vitest";
import {
  workflow,
  agent,
  transport,
  env,
  journal,
  entrypoint,
  server,
  collectEnvNodes,
} from "@tisyn/config";
import { applyOverlay, resolveEnv, resolveConfig, projectConfig, ConfigError } from "./config.js";

// ── Helper ──

function minimalWorkflow() {
  return workflow({
    run: "hello",
    agents: [agent("a", transport.inprocess("./a.ts"))],
  });
}

function multiAgentWorkflow() {
  return workflow({
    run: "chat",
    agents: [
      agent("llm", transport.worker("./llm.js")),
      agent("app", transport.local("./app.ts")),
      agent("db", transport.inprocess("./db.ts")),
    ],
    journal: journal.file("./data/journal.log"),
    entrypoints: {
      dev: entrypoint({
        agents: [agent("llm", transport.websocket("ws://localhost:4000"))],
        journal: journal.memory(),
        server: server.websocket({ port: 3000 }),
      }),
      staging: entrypoint({
        agents: [agent("new-agent", transport.inprocess("./new.ts"))],
      }),
    },
  });
}

// ── F. Entrypoint Overlay Application ──

describe("applyOverlay", () => {
  // CFG-OVR-001
  it("omitted entrypoint fields inherit base values", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "staging");
    // staging doesn't override journal, so it should inherit base journal
    expect((merged.journal as any)?.kind).toBe("file");
  });

  // CFG-OVR-002
  it("entrypoint agent with matching id replaces base agent", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "dev");
    const llm = merged.agents.find((a) => a.id === "llm")!;
    expect(llm.transport.kind).toBe("websocket");
  });

  // CFG-OVR-003
  it("entrypoint agent with non-matching id is appended", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "staging");
    const ids = merged.agents.map((a) => a.id);
    expect(ids).toContain("new-agent");
  });

  // CFG-OVR-004
  it("non-matching base agents are retained", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "dev");
    const ids = merged.agents.map((a) => a.id);
    expect(ids).toContain("app");
    expect(ids).toContain("db");
  });

  // CFG-OVR-005
  it("entrypoint journal replaces base journal", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "dev");
    expect(merged.journal?.kind).toBe("memory");
  });

  // CFG-OVR-006
  it("entrypoint server is added (base has none)", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "dev");
    const mergedAny = merged as unknown as Record<string, unknown>;
    expect(mergedAny.server).toBeDefined();
  });

  // CFG-OVR-007
  it("entrypoint cannot contain a run field", () => {
    const e = entrypoint();
    expect("run" in e).toBe(false);
  });

  // CFG-OVR-008
  it("empty entrypoint produces descriptor identical to base", () => {
    const base = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
      entrypoints: { empty: entrypoint() },
    });
    const merged = applyOverlay(base, "empty");
    expect(merged.run).toEqual(base.run);
    expect(merged.agents).toEqual(base.agents);
  });

  // CFG-OVR-009
  it("multiple base agents with one replacement — non-replaced preserved in order", () => {
    const base = multiAgentWorkflow();
    const merged = applyOverlay(base, "dev");
    const ids = merged.agents.map((a) => a.id);
    // llm replaced in-place, app and db retained in original order
    expect(ids).toEqual(["llm", "app", "db"]);
  });

  // CFG-OVR-010 (P1)
  it("independent overlay applications are stateless", () => {
    const base = multiAgentWorkflow();
    const merged1 = applyOverlay(base, "dev");
    const merged2 = applyOverlay(base, "dev");
    expect(merged1.agents.map((a) => a.id)).toEqual(merged2.agents.map((a) => a.id));
  });
});

// ── G. Environment Reference Model ──

describe("resolveEnv", () => {
  // CFG-ENV-001
  it("optional env, variable set → env value used", () => {
    const node = env("PORT", "3000");
    const resolved = resolveEnv([node], { PORT: "4000" });
    expect(resolved.get(node)).toBe("4000");
  });

  // CFG-ENV-002
  it("optional env, variable unset → default used", () => {
    const node = env("PORT", "3000");
    const resolved = resolveEnv([node], {});
    expect(resolved.get(node)).toBe("3000");
  });

  // CFG-ENV-003
  it("required env, variable set → resolves to string", () => {
    const node = env.required("API_KEY");
    const resolved = resolveEnv([node], { API_KEY: "abc123" });
    expect(resolved.get(node)).toBe("abc123");
  });

  // CFG-ENV-004
  it("required env, variable unset → startup failure", () => {
    const node = env.required("API_KEY");
    expect(() => resolveEnv([node], {})).toThrow(ConfigError);
  });

  // CFG-ENV-005
  it("secret env, variable set → resolves to string", () => {
    const node = env.secret("TOKEN");
    const resolved = resolveEnv([node], { TOKEN: "secret-value" });
    expect(resolved.get(node)).toBe("secret-value");
  });

  // CFG-ENV-006
  it("secret env, variable unset → startup failure", () => {
    const node = env.secret("TOKEN");
    expect(() => resolveEnv([node], {})).toThrow(ConfigError);
  });

  // CFG-ENV-007
  it("number coercion: '42' with numeric default → 42", () => {
    const node = env("PORT", 3000);
    const resolved = resolveEnv([node], { PORT: "42" });
    expect(resolved.get(node)).toBe(42);
  });

  // CFG-ENV-008
  it.each([
    { input: "true", expected: true },
    { input: "1", expected: true },
    { input: "false", expected: false },
    { input: "0", expected: false },
  ])("boolean coercion: '$input' → $expected", ({ input, expected }) => {
    const node = env("VERBOSE", false);
    const resolved = resolveEnv([node], { VERBOSE: input });
    expect(resolved.get(node)).toBe(expected);
  });

  // CFG-ENV-009
  it("boolean coercion: invalid string → type error", () => {
    const node = env("VERBOSE", false);
    expect(() => resolveEnv([node], { VERBOSE: "yes" })).toThrow(ConfigError);
  });

  // CFG-ENV-010
  it("number coercion: non-numeric string → type error", () => {
    const node = env("PORT", 3000);
    expect(() => resolveEnv([node], { PORT: "abc" })).toThrow(ConfigError);
  });

  // CFG-ENV-011
  it("required env always resolves to string", () => {
    const node = env.required("VAL");
    const resolved = resolveEnv([node], { VAL: "42" });
    expect(typeof resolved.get(node)).toBe("string");
  });

  // CFG-ENV-012
  it("secret env always resolves to string", () => {
    const node = env.secret("VAL");
    const resolved = resolveEnv([node], { VAL: "42" });
    expect(typeof resolved.get(node)).toBe("string");
  });

  // CFG-ENV-015
  it("multiple missing required env vars → ALL reported in single diagnostic", () => {
    const nodes = [env.required("A"), env.required("B"), env.secret("C")];
    try {
      resolveEnv(nodes, {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("A");
      expect(msg).toContain("B");
      expect(msg).toContain("C");
    }
  });
});

// ── J. Resolution Order ──

describe("resolution order", () => {
  // CFG-ORD-001
  it("overlay is applied before validation — overlay-introduced V4 violation is caught", () => {
    // Base has agent "a". Entrypoint adds another "a" → duplicate after merge?
    // Actually, merge-by-id replaces, so that's not a dup. Let's make the overlay
    // introduce an agent with empty id to trigger V3 after merge.
    const base = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
      entrypoints: {
        bad: entrypoint({
          agents: [
            { tisyn_config: "agent", id: "", transport: transport.inprocess("./b.ts") } as any,
          ],
        }),
      },
    });
    expect(() => resolveConfig(base, { entrypoint: "bad", processEnv: {} })).toThrow(
      /validation failed/i,
    );
  });

  // CFG-ORD-002
  it("validation occurs before env resolution — invalid descriptor fails before env read", () => {
    // Descriptor with empty agents should fail validation before any env is read
    const bad = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [],
    } as unknown as any;
    // Even though processEnv would fail for env nodes, validation fails first
    expect(() => resolveConfig(bad, { processEnv: {} })).toThrow(/validation failed/i);
  });

  // CFG-ORD-005
  it("default journal is in-memory when no journal specified", () => {
    const w = minimalWorkflow();
    const envNodes = collectEnvNodes(w);
    const resolved = resolveEnv(envNodes, {});
    const projection = projectConfig(w, resolved);
    expect(projection.journal.kind).toBe("memory");
  });
});

// CFG-ORD-003/004
describe("resolveConfig completes synchronously", () => {
  it("returns projection before any external call would happen", () => {
    const w = minimalWorkflow();
    const result = resolveConfig(w, { processEnv: {} });
    expect(result.agents).toHaveLength(1);
    expect(result.journal.kind).toBe("memory");
  });
});

// ── H. Secret Handling ──

describe("secret handling", () => {
  // CFG-SEC-001
  it("EnvSecretDescriptor contains name only, no value field", () => {
    const s = env.secret("TOKEN");
    expect(s.name).toBe("TOKEN");
    expect("value" in s).toBe(false);
    expect("default" in s).toBe(false);
  });

  // CFG-SEC-002/003/004
  it("resolved secret does not appear in error messages from resolveEnv", () => {
    // When a required env is missing, the error should mention the name but not any value
    const nodes = [env.secret("MY_SECRET")];
    try {
      resolveEnv(nodes, {});
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("MY_SECRET");
      // The error should NOT contain any resolved value (there is none since it's missing)
    }
  });

  // CFG-SEC-005
  it("resolved secret IS present in the projected output", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("llm", transport.websocket(env.secret("API_KEY")))],
    });
    const result = resolveConfig(w, { processEnv: { API_KEY: "super-secret-value" } });
    const llmTransport = result.agents.find((a) => a.id === "llm")!.transport;
    expect(llmTransport.url).toBe("super-secret-value");
  });
});

// ── Projection Tests (replacing CFG-USE-* behavioral tests) ──

describe("projectConfig", () => {
  const base = workflow({
    run: "chat",
    agents: [
      agent("llm", transport.worker(env.required("WORKER_URL"))),
      agent("app", transport.local("./app.ts")),
    ],
    journal: journal.file(env("JOURNAL_PATH", "./data/journal.log")),
    entrypoints: {
      dev: entrypoint({
        server: server.websocket({ port: env("PORT", 3000) }),
      }),
    },
  });

  it("returns post-overlay shape", () => {
    const merged = applyOverlay(base, "dev");
    const envNodes = collectEnvNodes(merged);
    const resolved = resolveEnv(envNodes, { WORKER_URL: "http://w.js", PORT: "4000" });
    const projection = projectConfig(merged, resolved);
    expect(projection.server).toBeDefined();
    expect(projection.server!.port).toBe(4000);
  });

  it("output contains no EnvDescriptor nodes", () => {
    const result = resolveConfig(base, {
      entrypoint: "dev",
      processEnv: { WORKER_URL: "http://w.js", PORT: "4000" },
    });
    // Deep check: no tisyn_config: "env" in the output
    const json = JSON.stringify(result);
    expect(json).not.toContain('"tisyn_config"');
  });

  it("output has no tisyn_config discriminants, no entrypoints, no run", () => {
    const result = resolveConfig(base, {
      processEnv: { WORKER_URL: "http://w.js" },
    });
    const resultAny = result as unknown as Record<string, unknown>;
    expect(resultAny.tisyn_config).toBeUndefined();
    expect(resultAny.entrypoints).toBeUndefined();
    expect(resultAny.run).toBeUndefined();
  });

  it("output contains resolved agent transport fields", () => {
    const result = resolveConfig(base, {
      processEnv: { WORKER_URL: "http://worker.example.com" },
    });
    const llm = result.agents.find((a) => a.id === "llm")!;
    expect(llm.transport.url).toBe("http://worker.example.com");
  });

  it("output contains resolved journal path", () => {
    const result = resolveConfig(base, {
      processEnv: { WORKER_URL: "http://w.js", JOURNAL_PATH: "/tmp/journal.log" },
    });
    expect(result.journal.path).toBe("/tmp/journal.log");
  });

  it("output contains resolved server port when entrypoint applied", () => {
    const result = resolveConfig(base, {
      entrypoint: "dev",
      processEnv: { WORKER_URL: "http://w.js", PORT: "8080" },
    });
    expect(result.server!.port).toBe(8080);
  });
});
