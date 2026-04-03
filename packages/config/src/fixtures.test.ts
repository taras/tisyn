import { describe, it, expect } from "vitest";
import { validateConfig } from "./validate.js";
import { workflow, agent, transport, env, journal, entrypoint, server } from "./constructors.js";
import { collectEnvNodes } from "./walk.js";

// ── K. Worked-Example Fixtures ──

// CFG-FIX-001 — §9.1 Minimal workflow
describe("§9.1 minimal workflow fixture", () => {
  it("produces a valid descriptor", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("greeter", transport.inprocess("./greeter-impl.ts"))],
    });
    expect(validateConfig(w).ok).toBe(true);
  });
});

// CFG-FIX-002 — §9.2 Multi-agent chat
describe("§9.2 multi-agent chat fixture", () => {
  it("produces a valid descriptor", () => {
    const w = workflow({
      run: "chat",
      agents: [
        agent("llm", transport.worker("./llm-worker.js")),
        agent("app", transport.local("./browser-agent.ts")),
      ],
      journal: journal.file(env("JOURNAL_PATH", "./data/chat.journal")),
      entrypoints: {
        dev: entrypoint({
          server: server.websocket({
            port: env("PORT", 3000),
            static: "./dist",
          }),
        }),
      },
    });
    expect(validateConfig(w).ok).toBe(true);
  });
});

// CFG-FIX-003 — §9.3 Separate-module fixture
describe("§9.3 separate-module fixture", () => {
  it("produces a valid descriptor", () => {
    const w = workflow({
      run: { export: "chat", module: "./workflow.generated.ts" },
      agents: [
        agent("llm", transport.websocket(env.required("LLM_ENDPOINT"))),
        agent("app", transport.local("./browser-agent.ts")),
      ],
    });
    expect(validateConfig(w).ok).toBe(true);
  });
});

// CFG-FIX-004 — §9.4 Walking §9.2 discovers expected env nodes
describe("§9.4 env walking on multi-agent chat fixture", () => {
  it("discovers JOURNAL_PATH and PORT env nodes", () => {
    const w = workflow({
      run: "chat",
      agents: [
        agent("llm", transport.worker("./llm-worker.js")),
        agent("app", transport.local("./browser-agent.ts")),
      ],
      journal: journal.file(env("JOURNAL_PATH", "./data/chat.journal")),
      entrypoints: {
        dev: entrypoint({
          server: server.websocket({
            port: env("PORT", 3000),
            static: "./dist",
          }),
        }),
      },
    });

    const nodes = collectEnvNodes(w);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("JOURNAL_PATH");
    expect(names).toContain("PORT");
    expect(nodes).toHaveLength(2);
  });
});

// CFG-FIX-005 — §9.5 Secret fixture
describe("§9.5 secret fixture", () => {
  it("produces correct secret env node", () => {
    const secretEnv = env.secret("OPENAI_API_KEY");
    expect(secretEnv).toEqual({
      tisyn_config: "env",
      mode: "secret",
      name: "OPENAI_API_KEY",
    });
  });
});

// CFG-FIX-006 — §9.7 Duplicate agent IDs fails validation (V4)
describe("§9.7 duplicate agent IDs fixture", () => {
  it("fails validation with V4", () => {
    const w = workflow({
      run: "chat",
      agents: [agent("llm", transport.worker("./a.js")), agent("llm", transport.worker("./b.js"))],
    });
    const result = validateConfig(w);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "V4")).toBe(true);
    }
  });
});

// CFG-FIX-007 — §9.7 Required env with default fails validation (V6)
describe("§9.7 required env with default fixture", () => {
  it("fails validation with V6", () => {
    const bad = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        {
          tisyn_config: "agent",
          id: "a",
          transport: {
            tisyn_config: "transport",
            kind: "worker",
            url: { tisyn_config: "env", mode: "required", name: "X", default: "y" },
          },
        },
      ],
    };
    const result = validateConfig(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.rule === "V6")).toBe(true);
    }
  });
});
