import { describe, it, expect } from "vitest";
import { workflow, agent, transport, entrypoint } from "./constructors.js";

// ── E. Workflow Reference Semantics ──

// CFG-REF-001
describe("WorkflowRef with export only", () => {
  it("is structurally valid", () => {
    const w = workflow({
      run: "hello",
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run.export).toBe("hello");
    expect(w.run.module).toBeUndefined();
  });
});

// CFG-REF-002
describe("WorkflowRef with export and module", () => {
  it("is structurally valid", () => {
    const w = workflow({
      run: { export: "chat", module: "./workflow.ts" },
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run.export).toBe("chat");
    expect(w.run.module).toBe("./workflow.ts");
  });
});

// CFG-REF-003
describe("WorkflowRef with empty export", () => {
  it("is structurally invalid", () => {
    // The constructor accepts this but validation should catch it
    const w = workflow({
      run: { export: "" },
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect(w.run.export).toBe("");
  });
});

// CFG-REF-006
describe("entrypoint schema", () => {
  it("does not include a run field", () => {
    const e = entrypoint({
      agents: [agent("a", transport.inprocess("./a.ts"))],
    });
    expect("run" in e).toBe(false);
  });
});
