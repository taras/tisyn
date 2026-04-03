import { describe, it, expect } from "vitest";
import {
  workflow,
  agent,
  transport,
  env,
  journal,
  entrypoint,
  server,
} from "./constructors.js";

// ── A. Constructor and Descriptor Formation ──

describe("workflow()", () => {
  // CFG-CON-001
  it("has tisyn_config: 'workflow' discriminant", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.tisyn_config).toBe("workflow");
  });

  // CFG-CON-002
  it("has run field and non-empty agents array", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run).toBeDefined();
    expect(w.agents.length).toBeGreaterThan(0);
  });

  // CFG-CON-003
  it("normalizes string run to WorkflowRef with export", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run).toEqual({ export: "hello" });
  });

  // CFG-CON-004
  it("preserves WorkflowRef with export and module", () => {
    const w = workflow({
      run: { export: "chat", module: "./w.ts" },
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run).toEqual({ export: "chat", module: "./w.ts" });
  });
});

// CFG-CON-005
describe("agent()", () => {
  it("has tisyn_config: 'agent', the provided id, and transport", () => {
    const t = transport.inprocess("./impl.ts");
    const a = agent("llm", t);
    expect(a.tisyn_config).toBe("agent");
    expect(a.id).toBe("llm");
    expect(a.transport).toBe(t);
  });
});

// CFG-CON-006
describe("transport constructors", () => {
  it.each([
    {
      name: "worker",
      make: () => transport.worker("./w.js"),
      kind: "worker",
      fields: { url: "./w.js" },
    },
    {
      name: "local",
      make: () => transport.local("./impl.ts"),
      kind: "local",
      fields: { module: "./impl.ts" },
    },
    {
      name: "stdio",
      make: () => transport.stdio("node", ["run.js"]),
      kind: "stdio",
      fields: { command: "node", args: ["run.js"] },
    },
    {
      name: "websocket",
      make: () => transport.websocket("ws://localhost:3000"),
      kind: "websocket",
      fields: { url: "ws://localhost:3000" },
    },
    {
      name: "inprocess",
      make: () => transport.inprocess("./agent.ts"),
      kind: "inprocess",
      fields: { module: "./agent.ts" },
    },
  ])("transport.$name produces tisyn_config: 'transport' with kind '$kind'", ({ make, kind, fields }) => {
    const t = make();
    expect(t.tisyn_config).toBe("transport");
    expect(t.kind).toBe(kind);
    for (const [key, value] of Object.entries(fields)) {
      expect((t as any)[key]).toEqual(value);
    }
  });
});

// CFG-CON-007
describe("env()", () => {
  it.each([
    { defaultValue: "fallback", type: "string" },
    { defaultValue: 42, type: "number" },
    { defaultValue: true, type: "boolean" },
  ])("produces optional env with $type default", ({ defaultValue }) => {
    const e = env("MY_VAR", defaultValue);
    expect(e.tisyn_config).toBe("env");
    expect(e.mode).toBe("optional");
    expect(e.name).toBe("MY_VAR");
    expect(e.default).toBe(defaultValue);
  });
});

// CFG-CON-008
describe("env.required()", () => {
  it("produces mode: 'required' with no default field", () => {
    const e = env.required("API_KEY");
    expect(e.tisyn_config).toBe("env");
    expect(e.mode).toBe("required");
    expect(e.name).toBe("API_KEY");
    expect("default" in e).toBe(false);
  });
});

// CFG-CON-009
describe("env.secret()", () => {
  it("produces mode: 'secret' with no default field", () => {
    const e = env.secret("TOKEN");
    expect(e.tisyn_config).toBe("env");
    expect(e.mode).toBe("secret");
    expect(e.name).toBe("TOKEN");
    expect("default" in e).toBe(false);
  });
});

// CFG-CON-010
describe("journal.file()", () => {
  it("produces tisyn_config: 'journal' with kind: 'file' and path", () => {
    const j = journal.file("./data/journal.log");
    expect(j.tisyn_config).toBe("journal");
    expect(j.kind).toBe("file");
    expect(j.path).toBe("./data/journal.log");
  });
});

// CFG-CON-011
describe("journal.memory()", () => {
  it("produces tisyn_config: 'journal' with kind: 'memory'", () => {
    const j = journal.memory();
    expect(j.tisyn_config).toBe("journal");
    expect(j.kind).toBe("memory");
  });
});

// CFG-CON-012
describe("entrypoint()", () => {
  it("produces tisyn_config: 'entrypoint'", () => {
    const e = entrypoint();
    expect(e.tisyn_config).toBe("entrypoint");
  });
});

// CFG-CON-013
describe("server.websocket()", () => {
  it("produces tisyn_config: 'server' with kind: 'websocket' and port", () => {
    const s = server.websocket({ port: 3000 });
    expect(s.tisyn_config).toBe("server");
    expect(s.kind).toBe("websocket");
    expect(s.port).toBe(3000);
  });
});

// CFG-CON-014
describe("env nodes in transport positions", () => {
  it("transport constructors accept EnvDescriptor in URL/command positions", () => {
    const urlEnv = env.required("WORKER_URL");
    const w = transport.worker(urlEnv);
    expect(w.url).toBe(urlEnv);

    const cmdEnv = env("CMD", "node");
    const s = transport.stdio(cmdEnv);
    expect(s.command).toBe(cmdEnv);

    const wsEnv = env.secret("WS_URL");
    const ws = transport.websocket(wsEnv);
    expect(ws.url).toBe(wsEnv);
  });
});

// CFG-CON-015
describe("serializable data domain", () => {
  it("all constructor outputs are JSON-round-trippable", () => {
    const w = workflow({
      run: "hello",
      agents: [
        agent("llm", transport.worker("./w.js")),
        agent("app", transport.local("./app.ts")),
      ],
      journal: journal.file(env("JOURNAL", "./j.log")),
      entrypoints: {
        dev: entrypoint({
          server: server.websocket({ port: env("PORT", 3000), static: "./dist" }),
        }),
      },
    });
    const roundTripped = JSON.parse(JSON.stringify(w));
    expect(roundTripped).toEqual(w);
  });
});

// CFG-CON-016
describe("constructor purity", () => {
  it("same arguments produce observationally equivalent results", () => {
    const a = workflow({
      run: "hello",
      agents: [agent("x", transport.inprocess("./x.ts"))],
    });
    const b = workflow({
      run: "hello",
      agents: [agent("x", transport.inprocess("./x.ts"))],
    });
    expect(a).toEqual(b);
  });
});

// CFG-CON-017 (P1)
describe("extension constructor", () => {
  it("custom kind output is within the serializable data domain", () => {
    const custom = {
      tisyn_config: "transport" as const,
      kind: "custom-grpc",
      endpoint: "localhost:50051",
    };
    const roundTripped = JSON.parse(JSON.stringify(custom));
    expect(roundTripped).toEqual(custom);
  });
});
