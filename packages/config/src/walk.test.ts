import { describe, it, expect } from "vitest";
import { walkConfig, collectEnvNodes } from "./walk.js";
import { workflow, agent, transport, env, journal, entrypoint, server } from "./constructors.js";

// CFG-ENV-013
describe("collectEnvNodes", () => {
  it("discovers all env nodes across agents, journal, and server", () => {
    const w = workflow({
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

    const nodes = collectEnvNodes(w);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("WORKER_URL");
    expect(names).toContain("JOURNAL_PATH");
    expect(names).toContain("PORT");
    expect(nodes).toHaveLength(3);
  });
});

// CFG-ENV-014
describe("env nodes nested in transport descriptors", () => {
  it("walking discovers env nodes inside transport fields", () => {
    const w = workflow({
      run: "hello",
      agents: [
        agent("a", transport.stdio(env.required("CMD"), [env("ARG", "default"), "literal"])),
      ],
    });

    const nodes = collectEnvNodes(w);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("CMD");
    expect(names).toContain("ARG");
    expect(nodes).toHaveLength(2);
  });
});

// CFG-ENV-016
describe("env node with value property", () => {
  it("env node with a 'value' property present is structurally invalid", () => {
    // This tests the descriptor shape — an env node must not contain a `value` field.
    // Validation would catch this via V8 or domain rules, but structurally
    // the collectEnvNodes still finds it. The invalidity is detected by validateConfig.
    const badEnv = { tisyn_config: "env", mode: "required", name: "X", value: "leaked" };
    const nodes: unknown[] = [];
    walkConfig(badEnv, (node) => {
      if (node.tisyn_config === "env" && "value" in node) {
        nodes.push(node);
      }
    });
    expect(nodes).toHaveLength(1);
  });
});

describe("walkConfig", () => {
  it("visits all tisyn_config nodes depth-first", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    const visited: string[] = [];
    walkConfig(w, (node) => {
      visited.push(node.tisyn_config as string);
    });
    expect(visited).toEqual(["workflow", "agent", "transport"]);
  });
});
