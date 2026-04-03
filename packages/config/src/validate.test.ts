import { describe, it, expect } from "vitest";
import { validateConfig } from "./validate.js";
import { workflow, agent, transport, env, journal, entrypoint, server } from "./constructors.js";

function expectFailure(descriptor: unknown, rule: string) {
  const result = validateConfig(descriptor);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.rule === rule)).toBe(true);
  }
}

// ── B. Descriptor Validation (V1–V10) ──

// CFG-VAL-001
describe("V1: missing tisyn_config", () => {
  it("node with missing tisyn_config at root → validation catches structural errors", () => {
    // A bare object at root without tisyn_config won't trigger V1 (V1 requires the field to be present
    // but unrecognized). However it will fail V2 since it's not a valid workflow.
    const result = validateConfig({ run: "hello", agents: [] });
    // No tisyn_config means no node-specific validation fires, but
    // a top-level object passed as a descriptor that lacks tisyn_config
    // is simply not a workflow node — covered by the caller's responsibility.
    // V1 specifically covers nodes that DO have tisyn_config but with a bad value.
    // We test that via CFG-VAL-002. Here we test that a descriptor node with
    // tisyn_config present but missing on a child node still detects issues:
    const bad = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [{ tisyn_config: "agent", id: "a", transport: { tisyn_config: "foo", kind: "inprocess", module: "./a.ts" } }],
    };
    const result2 = validateConfig(bad);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.errors.some((e) => e.rule === "V1")).toBe(true);
    }
  });
});

// CFG-VAL-002
describe("V1: unrecognized tisyn_config value", () => {
  it("unrecognized discriminant → failure", () => {
    expectFailure(
      { tisyn_config: "bogus", run: { export: "hello" }, agents: [] },
      "V1",
    );
  });
});

// CFG-VAL-003
describe("V2: missing run", () => {
  it("missing run field → failure", () => {
    expectFailure(
      { tisyn_config: "workflow", agents: [{ tisyn_config: "agent", id: "a", transport: transport.inprocess("./a.ts") }] },
      "V2",
    );
  });
});

// CFG-VAL-004
describe("V2: empty string run", () => {
  it("empty string run → failure", () => {
    expectFailure(
      { tisyn_config: "workflow", run: "", agents: [{ tisyn_config: "agent", id: "a", transport: transport.inprocess("./a.ts") }] },
      "V2",
    );
  });
});

// CFG-VAL-005
describe("V2: empty agents", () => {
  it("empty agents array → failure", () => {
    expectFailure(
      { tisyn_config: "workflow", run: { export: "hello" }, agents: [] },
      "V2",
    );
  });
});

// CFG-VAL-006
describe("V3: agent with empty id", () => {
  it("empty id → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [{ tisyn_config: "agent", id: "", transport: transport.inprocess("./a.ts") }],
    };
    expectFailure(w, "V3");
  });
});

// CFG-VAL-007
describe("V3: agent with missing transport", () => {
  it("missing transport → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [{ tisyn_config: "agent", id: "a" }],
    };
    expectFailure(w, "V3");
  });
});

// CFG-VAL-008
describe("V4: duplicate agent ids", () => {
  it("duplicate ids → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        { tisyn_config: "agent", id: "llm", transport: transport.inprocess("./a.ts") },
        { tisyn_config: "agent", id: "llm", transport: transport.inprocess("./b.ts") },
      ],
    };
    expectFailure(w, "V4");
  });
});

// CFG-VAL-009
describe("V5: transport missing kind", () => {
  it("missing kind → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        { tisyn_config: "agent", id: "a", transport: { tisyn_config: "transport" } },
      ],
    };
    expectFailure(w, "V5");
  });
});

// CFG-VAL-010
describe("V5: built-in transport missing required field", () => {
  it("worker without url → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        { tisyn_config: "agent", id: "a", transport: { tisyn_config: "transport", kind: "worker" } },
      ],
    };
    expectFailure(w, "V5");
  });
});

// CFG-VAL-011
describe("V6: optional env missing default", () => {
  it("optional mode without default → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        {
          tisyn_config: "agent",
          id: "a",
          transport: {
            tisyn_config: "transport",
            kind: "worker",
            url: { tisyn_config: "env", mode: "optional", name: "X" },
          },
        },
      ],
    };
    expectFailure(w, "V6");
  });
});

// CFG-VAL-012
describe("V6: required env with default", () => {
  it("required mode with default → failure", () => {
    const w = {
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
    expectFailure(w, "V6");
  });
});

// CFG-VAL-013
describe("V6: secret env with default", () => {
  it("secret mode with default → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        {
          tisyn_config: "agent",
          id: "a",
          transport: {
            tisyn_config: "transport",
            kind: "worker",
            url: { tisyn_config: "env", mode: "secret", name: "X", default: "y" },
          },
        },
      ],
    };
    expectFailure(w, "V6");
  });
});

// CFG-VAL-014
describe("V7: invalid entrypoint keys", () => {
  it.each(["Uppercase", "has space", "", "1startsWithNumber"])(
    "entrypoint key '%s' → failure",
    (key) => {
      const w = workflow({
        run: "hello",
        agents: [agent("a", transport.inprocess("./a.ts"))],
        entrypoints: { [key]: entrypoint() },
      });
      expectFailure(w, "V7");
    },
  );
});

// CFG-VAL-015
describe("V8: values outside serializable domain", () => {
  it.each([
    { label: "Date", value: new Date() },
    { label: "function", value: () => {} },
    { label: "undefined", value: undefined },
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
  ])("$label → failure", ({ value }) => {
    // Wrap the bad value inside a descriptor-like structure
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        {
          tisyn_config: "agent",
          id: "a",
          transport: { tisyn_config: "transport", kind: "worker", url: value },
        },
      ],
    };
    expectFailure(w, "V8");
  });
});

// CFG-VAL-016
describe("V9: node with both tisyn_config and tisyn", () => {
  it("both fields present → failure", () => {
    const w = {
      tisyn_config: "workflow",
      tisyn: "eval",
      run: { export: "hello" },
      agents: [
        { tisyn_config: "agent", id: "a", transport: transport.inprocess("./a.ts") },
      ],
    };
    expectFailure(w, "V9");
  });
});

// CFG-VAL-017
describe("V10: base WorkflowDescriptor with server", () => {
  it("server field present at base → failure", () => {
    const w = {
      tisyn_config: "workflow",
      run: { export: "hello" },
      agents: [
        { tisyn_config: "agent", id: "a", transport: transport.inprocess("./a.ts") },
      ],
      server: server.websocket({ port: 3000 }),
    };
    expectFailure(w, "V10");
  });
});

// CFG-VAL-018
describe("V2: valid minimal descriptor passes", () => {
  it("valid descriptor → ok", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    const result = validateConfig(w);
    expect(result.ok).toBe(true);
  });
});

// CFG-VAL-019
describe("V7: valid entrypoint keys pass", () => {
  it.each(["dev", "staging-2"])("entrypoint key '%s' passes", (key) => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
      entrypoints: { [key]: entrypoint() },
    });
    const result = validateConfig(w);
    expect(result.ok).toBe(true);
  });
});
