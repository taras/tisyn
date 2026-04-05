/**
 * Tests for @tisyn/cli operations.
 *
 * Uses @effectionx/vitest for generator-based test bodies (Operations).
 * Each test that exercises an Effection operation runs inside a managed scope.
 */

import { describe, it } from "@effectionx/vitest";
import { expect, afterEach } from "vitest";
import { call, each, spawn } from "effection";
import type { Operation } from "effection";
import { exec } from "@effectionx/process";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { topoSort, runGenerate, runBuild } from "./compile.js";
import { discoverConfig, validateAndResolveConfig, ConfigError } from "./config.js";
import { buildInputSchema } from "@tisyn/compiler";
import { deriveFlags, parseInputFlags, formatInputHelp } from "./inputs.js";
import { CliError } from "./load-descriptor.js";
import { loadModule, isTypeScriptFile } from "./load-module.js";
import { loadLocalBinding, startServer } from "./startup.js";
import { rebaseConfigPaths } from "./run.js";
import type { ResolvedConfig } from "@tisyn/runtime";

// ── Temp dir helpers ──────────────────────────────────────────────────────────

const temps: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tisyn-cli-test-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── topoSort ─────────────────────────────────────────────────────────────────

describe("topoSort", () => {
  it("sorts a linear chain A → B → C", function* () {
    const graph = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    const order = topoSort(["a", "b", "c"], graph);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("throws ConfigError on a cycle", function* () {
    const graph = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(() => topoSort(["a", "b"], graph)).toThrow(ConfigError);
  });
});

// ── discoverConfig ────────────────────────────────────────────────────────────

describe("discoverConfig", () => {
  it("finds config in the current directory", function* () {
    const dir = yield* call(makeTempDir);
    const configPath = join(dir, "tisyn.config.ts");
    yield* call(() => writeFile(configPath, "export default { generates: [] };"));
    const found = yield* discoverConfig(dir);
    expect(found).toBe(configPath);
  });

  it("walks up to find config in a parent directory", function* () {
    const dir = yield* call(makeTempDir);
    const configPath = join(dir, "tisyn.config.ts");
    yield* call(() => writeFile(configPath, "export default { generates: [] };"));
    const child = join(dir, "sub", "project");
    yield* call(() => mkdir(child, { recursive: true }));
    const found = yield* discoverConfig(child);
    expect(found).toBe(configPath);
  });

  it("throws ConfigError when no config file exists", function* () {
    const dir = yield* call(makeTempDir);
    let threw = false;
    try {
      yield* discoverConfig(dir);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConfigError);
    }
    expect(threw).toBe(true);
  });
});

// ── validateAndResolveConfig ──────────────────────────────────────────────────

describe("validateAndResolveConfig", () => {
  it("resolves a valid config", function* () {
    const dir = yield* call(makeTempDir);
    const inputPath = join(dir, "workflow.ts");
    yield* call(() => writeFile(inputPath, ""));
    const configPath = join(dir, "tisyn.config.ts");

    const config = {
      generates: [{ name: "my-pass", input: "workflow.ts", output: "out.ts" }],
    };
    const passes = yield* validateAndResolveConfig(config, configPath);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.name).toBe("my-pass");
  });

  it("throws on missing generates", function* () {
    const dir = yield* call(makeTempDir);
    const configPath = join(dir, "tisyn.config.ts");
    let threw = false;
    try {
      yield* validateAndResolveConfig({ generates: [] }, configPath);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConfigError);
    }
    expect(threw).toBe(true);
  });

  it("throws on duplicate pass name", function* () {
    const dir = yield* call(makeTempDir);
    const inputPath = join(dir, "workflow.ts");
    yield* call(() => writeFile(inputPath, ""));
    const configPath = join(dir, "tisyn.config.ts");
    const config = {
      generates: [
        { name: "pass", input: "workflow.ts", output: "out1.ts" },
        { name: "pass", input: "workflow.ts", output: "out2.ts" },
      ],
    };
    let threw = false;
    try {
      yield* validateAndResolveConfig(config, configPath);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConfigError);
    }
    expect(threw).toBe(true);
  });

  it("throws on unknown dependsOn", function* () {
    const dir = yield* call(makeTempDir);
    const inputPath = join(dir, "workflow.ts");
    yield* call(() => writeFile(inputPath, ""));
    const configPath = join(dir, "tisyn.config.ts");
    const config = {
      generates: [
        { name: "pass", input: "workflow.ts", output: "out.ts", dependsOn: ["nonexistent"] },
      ],
    };
    let threw = false;
    try {
      yield* validateAndResolveConfig(config, configPath);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConfigError);
    }
    expect(threw).toBe(true);
  });
});

// ── runGenerate ───────────────────────────────────────────────────────────────

const MINIMAL_WORKFLOW = `
export function* hello() {
  return "world";
}
`;

describe("runGenerate", () => {
  it("writes the generated file when --output is given", function* () {
    const dir = yield* call(makeTempDir);
    const inputPath = join(dir, "workflow.ts");
    yield* call(() => writeFile(inputPath, MINIMAL_WORKFLOW));
    const outputPath = join(dir, "workflow.generated.ts");

    yield* runGenerate(
      {
        input: inputPath,
        include: [],
        output: outputPath,
        format: "printed",
        validate: false,
        verbose: false,
      },
      dir,
    );

    const content = yield* call(() => readFile(outputPath, "utf-8"));
    expect(content).toContain("Auto-generated");
  });

  it("writes to stdout when no --output is given", function* () {
    const dir = yield* call(makeTempDir);
    const inputPath = join(dir, "workflow.ts");
    yield* call(() => writeFile(inputPath, MINIMAL_WORKFLOW));

    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: unknown }).write = (chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    };

    try {
      yield* runGenerate(
        {
          input: inputPath,
          include: [],
          output: undefined,
          format: "printed",
          validate: false,
          verbose: false,
        },
        dir,
      );
    } finally {
      process.stdout.write = orig;
    }

    expect(chunks.join("")).toContain("Auto-generated");
  });
});

// ── runBuild (two passes) ─────────────────────────────────────────────────────

describe("runBuild", () => {
  it("runs two passes and creates both output files", function* () {
    const dir = yield* call(makeTempDir);

    const workflow1 = join(dir, "workflow1.ts");
    yield* call(() => writeFile(workflow1, MINIMAL_WORKFLOW));

    const workflow2 = join(dir, "workflow2.ts");
    yield* call(() =>
      writeFile(
        workflow2,
        `
export function* greet() {
  return "hello";
}
`,
      ),
    );

    const passes = [
      {
        name: "pass-a",
        input: workflow1,
        include: [],
        output: join(dir, "out-a.ts"),
        format: "printed" as const,
        noValidate: true,
        dependsOn: [],
      },
      {
        name: "pass-b",
        input: workflow2,
        include: [],
        output: join(dir, "out-b.ts"),
        format: "printed" as const,
        noValidate: true,
        dependsOn: [],
      },
    ];

    yield* runBuild(passes, { verbose: false }, dir);

    const outA = yield* call(() => readFile(join(dir, "out-a.ts"), "utf-8"));
    const outB = yield* call(() => readFile(join(dir, "out-b.ts"), "utf-8"));
    expect(outA).toContain("Auto-generated");
    expect(outB).toContain("Auto-generated");
  });
});

// ── CLI entry surface ─────────────────────────────────────────────────────────

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const NOOP_AGENT = join(dirname(fileURLToPath(import.meta.url)), "noop-agent.mjs");

describe("CLI entry surface", () => {
  it("--help exits 0 and prints usage", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "--help"] }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("tsn");
  });

  it("--version exits 0 and prints the package version string", function* () {
    const req = createRequire(import.meta.url);
    const { version } = req("../package.json") as { version: string };
    const result = yield* exec("node", { arguments: [CLI_BIN, "--version"] }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout.trim()).toBe(version);
  });

  it("generate --help exits 0 and prints command-level help", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "generate", "--help"] }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("generate");
  });

  it("unknown subcommand exits 2", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "notacommand"] }).join();
    expect(result.code).toBe(2);
  });

  it("generate with missing input exits non-zero", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "generate"] }).join();
    expect(result.code).not.toBe(0);
  });

  it("run --help exits 0 and prints command-level help", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "run", "--help"] }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("module");
  });

  it("check --help exits 0 and prints command-level help", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "check", "--help"] }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("env-example");
  });

  it("run with missing module argument exits non-zero", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "run"] }).join();
    expect(result.code).not.toBe(0);
  });

  it("check with missing module argument exits non-zero", function* () {
    const result = yield* exec("node", { arguments: [CLI_BIN, "check"] }).join();
    expect(result.code).not.toBe(0);
  });

  it("run with nonexistent descriptor exits 3", function* () {
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", "/tmp/nonexistent-descriptor.ts"],
    }).join();
    expect(result.code).toBe(3);
  });

  it("check with nonexistent descriptor exits 3", function* () {
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", "/tmp/nonexistent-descriptor.ts"],
    }).join();
    expect(result.code).toBe(3);
  });
});

// ── Input flag parsing ──────────────────────────────────────────────────────

describe("input flag parsing", () => {
  it("derives kebab-case flags from camelCase fields", function* () {
    const schema = buildInputSchema(["{ maxTurns: number; modelName: string }"]);
    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(2);
    expect(flags[0]!.flag).toBe("max-turns");
    expect(flags[1]!.flag).toBe("model-name");
  });

  it("parses string and number flags", function* () {
    const schema = buildInputSchema(["{ name: string; count: number }"]);
    const flags = deriveFlags(schema);
    const parsed = parseInputFlags(flags, ["--name", "hello", "--count", "42"]);
    expect(parsed).toEqual({ name: "hello", count: 42 });
  });

  it("parses boolean presence flags", function* () {
    const schema = buildInputSchema(["{ debug: boolean }"]);
    const flags = deriveFlags(schema);
    const parsed = parseInputFlags(flags, ["--debug"]);
    expect(parsed).toEqual({ debug: true });
  });

  it("boolean flag absent → false", function* () {
    const schema = buildInputSchema(["{ debug: boolean }"]);
    const flags = deriveFlags(schema);
    const parsed = parseInputFlags(flags, []);
    expect(parsed).toEqual({ debug: false });
  });

  it("unknown flag → exit 4", function* () {
    const schema = buildInputSchema(["{ name: string }"]);
    const flags = deriveFlags(schema);
    expect(() => parseInputFlags(flags, ["--unknown", "val"])).toThrow(CliError);
    try {
      parseInputFlags(flags, ["--unknown", "val"]);
    } catch (e) {
      expect((e as CliError).exitCode).toBe(4);
    }
  });

  it("missing required flag → exit 4", function* () {
    const schema = buildInputSchema(["{ name: string }"]);
    const flags = deriveFlags(schema);
    expect(() => parseInputFlags(flags, [])).toThrow(CliError);
    try {
      parseInputFlags(flags, []);
    } catch (e) {
      expect((e as CliError).exitCode).toBe(4);
    }
  });

  it("number coercion failure → exit 4", function* () {
    const schema = buildInputSchema(["{ count: number }"]);
    const flags = deriveFlags(schema);
    expect(() => parseInputFlags(flags, ["--count", "abc"])).toThrow(CliError);
    try {
      parseInputFlags(flags, ["--count", "abc"]);
    } catch (e) {
      expect((e as CliError).exitCode).toBe(4);
    }
  });

  it("optional field not provided → omitted from result", function* () {
    const schema = buildInputSchema(["{ name: string; tag?: string }"]);
    const flags = deriveFlags(schema);
    const parsed = parseInputFlags(flags, ["--name", "hello"]);
    expect(parsed).toEqual({ name: "hello" });
  });

  it("formatInputHelp produces readable output", function* () {
    const schema = buildInputSchema(["{ name: string; debug?: boolean }"]);
    const flags = deriveFlags(schema);
    const help = formatInputHelp(flags);
    expect(help).toContain("--name");
    expect(help).toContain("(required)");
    expect(help).toContain("--debug");
    expect(help).toContain("(optional)");
  });
});

// ── rebaseConfigPaths ─────────────────────────────────────────────────────────

describe("rebaseConfigPaths", () => {
  it("resolves relative local transport module path", function* () {
    const config: ResolvedConfig = {
      agents: [{ id: "a", transport: { kind: "local", module: "./agent.js" } }],
      journal: { kind: "memory" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.agents[0]!.transport.module).toBe("/project/descriptors/agent.js");
  });

  it("leaves absolute transport module path unchanged", function* () {
    const config: ResolvedConfig = {
      agents: [{ id: "a", transport: { kind: "inprocess", module: "/abs/agent.js" } }],
      journal: { kind: "memory" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.agents[0]!.transport.module).toBe("/abs/agent.js");
  });

  it("resolves relative server static path", function* () {
    const config: ResolvedConfig = {
      agents: [],
      journal: { kind: "memory" },
      server: { kind: "http", port: 3000, static: "./public" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.server!.static).toBe("/project/descriptors/public");
  });

  it("resolves relative file journal path", function* () {
    const config: ResolvedConfig = {
      agents: [],
      journal: { kind: "file", path: "./data/journal.log" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.journal.path).toBe("/project/descriptors/data/journal.log");
  });

  it("resolves relative worker URL that looks like a file path", function* () {
    const config: ResolvedConfig = {
      agents: [{ id: "w", transport: { kind: "worker", url: "./worker.js" } }],
      journal: { kind: "memory" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.agents[0]!.transport.url).toBe("/project/descriptors/worker.js");
  });

  it("leaves worker URL with protocol unchanged", function* () {
    const config: ResolvedConfig = {
      agents: [{ id: "w", transport: { kind: "worker", url: "http://localhost:4000/worker.js" } }],
      journal: { kind: "memory" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.agents[0]!.transport.url).toBe("http://localhost:4000/worker.js");
  });

  it("resolves relative stdio command starting with ./", function* () {
    const config: ResolvedConfig = {
      agents: [{ id: "s", transport: { kind: "stdio", command: "./bin/agent" } }],
      journal: { kind: "memory" },
    };
    rebaseConfigPaths(config, "/project/descriptors");
    expect(config.agents[0]!.transport.command).toBe("/project/descriptors/bin/agent");
  });
});

// ── shared module loader ────────────────────────────────────────────────────────

describe("shared module loader", () => {
  it("loads a .js module", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "test-module.mjs");
    yield* call(() => writeFile(modulePath, `export default { hello: "world" };\n`));
    const mod = yield* call(() => loadModule(modulePath));
    expect((mod.default as Record<string, unknown>).hello).toBe("world");
  });

  it("loads a .ts module", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "test-module.ts");
    yield* call(() => writeFile(modulePath, `const x: string = "hello";\nexport default { x };\n`));
    const mod = yield* call(() => loadModule(modulePath));
    expect((mod.default as Record<string, unknown>).x).toBe("hello");
  });

  it("rejects unsupported extension", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "test-module.tsx");
    yield* call(() => writeFile(modulePath, `export default {};\n`));
    let threw = false;
    try {
      yield* call(() => loadModule(modulePath));
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(3);
      expect((err as CliError).message).toContain("Unsupported");
    }
    expect(threw).toBe(true);
  });

  it("reports not found for missing file", function* () {
    let threw = false;
    try {
      yield* call(() => loadModule("/tmp/nonexistent-cli-test-xyz.ts"));
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(3);
      expect((err as CliError).message).toContain("not found");
    }
    expect(threw).toBe(true);
  });

  it("classifies TypeScript and JavaScript extensions", function* () {
    expect(isTypeScriptFile("foo.ts")).toBe(true);
    expect(isTypeScriptFile("foo.mts")).toBe(true);
    expect(isTypeScriptFile("foo.cts")).toBe(true);
    expect(isTypeScriptFile("foo.js")).toBe(false);
    expect(isTypeScriptFile("foo.mjs")).toBe(false);
    expect(isTypeScriptFile("foo.cjs")).toBe(false);
  });
});

// ── Fixture helpers for E2E tests ─────────────────────────────────────────────

const FIXTURE_WORKFLOW = `
export const myWorkflow = {
  tisyn: "fn",
  params: ["input"],
  body: { tisyn: "eval", code: "Q(null)" },
};
export const inputSchemas = {
  myWorkflow: {
    type: "object",
    fields: [
      { name: "maxTurns", fieldType: "number", optional: false },
      { name: "modelName", fieldType: "string", optional: true },
    ],
  },
};
`;

const FIXTURE_WORKFLOW_NO_SCHEMA = `
export const myWorkflow = {
  tisyn: "fn",
  params: ["input"],
  body: { tisyn: "eval", code: "Q(null)" },
};
`;

const FIXTURE_WORKFLOW_UNSUPPORTED = `
export const myWorkflow = {
  tisyn: "fn",
  params: ["input"],
  body: { tisyn: "eval", code: "Q(null)" },
};
export const inputSchemas = {
  myWorkflow: { type: "unsupported", reason: "tuple parameter" },
};
`;

const FIXTURE_WORKFLOW_NONE = `
export const myWorkflow = {
  tisyn: "fn",
  params: [],
  body: { tisyn: "eval", code: "Q(null)" },
};
export const inputSchemas = {
  myWorkflow: { type: "none" },
};
`;

const FIXTURE_WORKFLOW_EMPTY_OBJECT = `
export const myWorkflow = {
  tisyn: "fn",
  params: ["input"],
  body: { tisyn: "eval", code: "Q(null)" },
};
export const inputSchemas = {
  myWorkflow: { type: "object", fields: [] },
};
`;

function descriptorSource(opts?: { entrypoints?: boolean; serverEntrypoint?: boolean }): string {
  let entrypoints = "";
  if (opts?.serverEntrypoint) {
    entrypoints = `entrypoints: { dev: { tisyn_config: "entrypoint", server: { tisyn_config: "server", kind: "websocket", port: 0 } } },`;
  } else if (opts?.entrypoints) {
    entrypoints = `entrypoints: { dev: { tisyn_config: "entrypoint" }, staging: { tisyn_config: "entrypoint" } },`;
  }
  // serverEntrypoint tests need a valid agent (V2 requires non-empty agents)
  const agents = opts?.serverEntrypoint
    ? `agents: [{ tisyn_config: "agent", id: "dummy", transport: { tisyn_config: "transport", kind: "websocket", url: "ws://localhost:9999" } }],`
    : "agents: [],";
  return `
export default {
  tisyn_config: "workflow",
  run: { export: "myWorkflow", module: "./workflow.generated.mjs" },
  ${agents}
  journal: { tisyn_config: "journal", kind: "memory" },
  ${entrypoints}
};
`;
}

function* writeFixture(
  dir: string,
  workflow: string,
  descriptorOpts?: { entrypoints?: boolean; serverEntrypoint?: boolean },
): Operation<string> {
  yield* call(() => writeFile(join(dir, "workflow.generated.mjs"), workflow));
  const descriptorPath = join(dir, "descriptor.mjs");
  yield* call(() => writeFile(descriptorPath, descriptorSource(descriptorOpts)));
  return descriptorPath;
}

// ── argv partitioning ─────────────────────────────────────────────────────────

describe("argv partitioning", () => {
  it("--verbose after module is not rejected as unknown workflow flag", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--verbose", "--max-turns", "5"],
    }).join();
    // Must not exit 4 with "Unknown flag: --verbose"
    expect(result.code).not.toBe(4);
    expect(result.stderr).not.toContain("Unknown flag: --verbose");
  });

  it("--entrypoint after module is not rejected as unknown workflow flag", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW, { entrypoints: true });
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--entrypoint", "dev", "--max-turns", "5"],
    }).join();
    // Must not exit 4 with "Unknown flag: --entrypoint"
    expect(result.code).not.toBe(4);
    expect(result.stderr).not.toContain("Unknown flag: --entrypoint");
  });

  it("workflow-only flags parse correctly without built-in leakage", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--max-turns", "10"],
    }).join();
    // Must not exit 4 — max-turns is a valid workflow flag
    expect(result.code).not.toBe(4);
  });
});

// ── dynamic help ──────────────────────────────────────────────────────────────

describe("dynamic help", () => {
  it("tsn run <module> --help shows workflow-derived flags", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--help"],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("--max-turns");
    expect(result.stdout).toContain("--model-name");
    expect(result.stdout).toContain("--entrypoint");
  });

  it("tsn run <module> --help shows entrypoints", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW, { entrypoints: true });
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--help"],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Entrypoints:");
    expect(result.stdout).toContain("dev");
    expect(result.stdout).toContain("staging");
  });

  it("tsn run <nonexistent> --help shows built-in help plus diagnostic", function* () {
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", "/tmp/nonexistent-descriptor-help.mjs", "--help"],
    }).join();
    expect(result.code).toBe(3);
    expect(result.stdout).toContain("Usage: tsn run");
    expect(result.stderr).toContain("Could not load workflow");
  });

  it("tsn run <module> --help with unsupported schema shows diagnostic", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_UNSUPPORTED);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--help"],
    }).join();
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Usage: tsn run");
    expect(result.stderr).toContain("unsupported input parameters");
  });

  it("tsn run <module> --help with missing schema shows diagnostic", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_NO_SCHEMA);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--help"],
    }).join();
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Usage: tsn run");
    expect(result.stderr).toContain("input schema metadata");
  });
});

// ── unknown tokens in workflow-input remainder ──────────────────────────────

describe("unknown tokens in workflow-input remainder", () => {
  it("zero-parameter workflow rejects unknown flags with exit 4", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_NONE);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--bogus"],
    }).join();
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  });

  it("empty-object-schema workflow rejects unknown flags with exit 4", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_EMPTY_OBJECT);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "--bogus"],
    }).join();
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  });

  it("unknown short flag -x after module exits with code 4", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "-x", "--max-turns", "5"],
    }).join();
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Unexpected argument: -x");
  });

  it("bare positional arg after module exits with code 4", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "stray", "--max-turns", "5"],
    }).join();
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Unexpected argument: stray");
  });
});

// ── entrypoint overlay ───────────────────────────────��──────────────────────

describe("entrypoint overlay", () => {
  it("entrypoint-introduced server does not fail V10 base validation", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_NONE, {
      serverEntrypoint: true,
    });
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", descriptorPath, "-e", "dev"],
    }).join();
    // Must not fail with config validation / V10 error
    expect(result.code).not.toBe(5);
    expect(result.stderr).not.toContain("V10");
    expect(result.stderr).not.toContain("Config validation failed");
  });
});

// ── local agent binding contract ─────────────────────────────────────────────

describe("local agent binding contract", () => {
  it("prefers createBinding() over createTransport()", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "binding-module.mjs");
    yield* call(() =>
      writeFile(
        modulePath,
        `
export function createBinding() {
  return {
    transport: function*() {
      return { send: function*(){}, receive: { [Symbol.iterator](){return this}, next(){return {done:true,value:undefined}} } };
    },
    _source: "createBinding",
  };
}

export function createTransport() {
  return function*() {
    return { send: function*(){}, receive: { [Symbol.iterator](){return this}, next(){return {done:true,value:undefined}} } };
  };
}
`,
      ),
    );
    const binding = yield* loadLocalBinding(modulePath);
    // Should have used createBinding (has _source marker)
    expect((binding as Record<string, unknown>)._source).toBe("createBinding");
    expect(binding.transport).toBeTypeOf("function");
  });

  it("falls back to createTransport() when createBinding is absent", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "transport-only.mjs");
    yield* call(() =>
      writeFile(
        modulePath,
        `
export function createTransport() {
  const factory = function*() {
    return { send: function*(){}, receive: { [Symbol.iterator](){return this}, next(){return {done:true,value:undefined}} } };
  };
  factory._source = "createTransport";
  return factory;
}
`,
      ),
    );
    const binding = yield* loadLocalBinding(modulePath);
    expect(binding.transport).toBeTypeOf("function");
    expect(binding.bindServer).toBeUndefined();
  });

  it("throws CliError when module exports neither", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "empty-module.mjs");
    yield* call(() => writeFile(modulePath, `export const nothing = true;\n`));
    let threw = false;
    try {
      yield* loadLocalBinding(modulePath);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("createBinding()");
      expect((err as CliError).message).toContain("createTransport()");
    }
    expect(threw).toBe(true);
  });

  it("returns bindServer when createBinding provides it", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "with-bind.mjs");
    yield* call(() =>
      writeFile(
        modulePath,
        `
export function createBinding() {
  return {
    transport: function*() {
      return { send: function*(){}, receive: { [Symbol.iterator](){return this}, next(){return {done:true,value:undefined}} } };
    },
    bindServer: function*(server) {
      // setup hook
    },
  };
}
`,
      ),
    );
    const binding = yield* loadLocalBinding(modulePath);
    expect(binding.bindServer).toBeTypeOf("function");
  });

  it("loads a TypeScript transport binding module", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "binding.ts");
    yield* call(() =>
      writeFile(
        modulePath,
        `
export function createBinding() {
  return {
    transport: function*() {
      return { send: function*(){}, receive: { [Symbol.iterator](){return this}, next(){return {done:true,value:undefined}} } };
    },
  };
}
`,
      ),
    );
    const binding = yield* loadLocalBinding(modulePath);
    expect(binding.transport).toBeTypeOf("function");
  });
});

// ── startServer connection stream ────────────────────────────────────────────

describe("startServer connection stream", () => {
  it("exposes accepted connections via LocalServerBinding.connections", function* () {
    const serverBinding = yield* startServer({ kind: "websocket", port: 0 });

    expect(serverBinding.address).toBeDefined();
    expect(serverBinding.connections).toBeDefined();

    const port = serverBinding.address.port;

    // Spawn a listener that captures the first connection
    let receivedConnection = false;
    yield* spawn(function* () {
      for (const connOp of yield* each(serverBinding.connections!)) {
        yield* connOp;
        receivedConnection = true;
        break;
        yield* each.next();
      }
    });

    // Connect a WebSocket client
    yield* call(
      () =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}`);
          ws.on("open", () => {
            // Small delay to let the server-side process the connection
            setTimeout(() => {
              ws.close();
              resolve();
            }, 50);
          });
          ws.on("error", reject);
        }),
    );

    expect(receivedConnection).toBe(true);
  });

  it("does not expose raw WebSocketServer", function* () {
    const serverBinding = yield* startServer({ kind: "websocket", port: 0 });
    expect("wss" in serverBinding).toBe(false);
  });
});

// ── bindServer lifecycle ─────────────────────────────────────────────────────

describe("bindServer lifecycle", () => {
  it("bindServer spawns long-lived work without blocking startup", function* () {
    const dir = yield* call(makeTempDir);
    const modulePath = join(dir, "lifecycle-module.mjs");
    // Top-level await for the import so spawn/each are available in generators
    yield* call(() =>
      writeFile(
        modulePath,
        `
import { spawn, each } from "effection";

// Shared state between bindServer and transport
let bindServerCalled = false;

export function createBinding() {
  return {
    transport: function*() {
      return {
        send: function*() {},
        receive: {
          [Symbol.iterator]() { return this; },
          next() {
            return { done: true, value: { bindServerCalled } };
          },
        },
      };
    },
    bindServer: function*(server) {
      bindServerCalled = true;
      // Spawn a long-lived connection acceptance loop
      yield* spawn(function*() {
        if (server.connections) {
          for (const conn of yield* each(server.connections)) {
            yield* conn;
            yield* each.next();
          }
        }
      });
      // Returns promptly - does NOT block
    },
  };
}
`,
      ),
    );

    // Load the binding
    const binding = yield* loadLocalBinding(modulePath);
    expect(binding.bindServer).toBeTypeOf("function");

    // Start a server to get a real LocalServerBinding
    const serverBinding = yield* startServer({ kind: "websocket", port: 0 });

    // Call bindServer — should return promptly (not block)
    yield* binding.bindServer!(serverBinding);

    // Verify the spawned loop is running by connecting a client
    const port = serverBinding.address.port;
    yield* call(
      () =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}`);
          ws.on("open", () => {
            ws.close();
            resolve();
          });
          ws.on("error", reject);
        }),
    );
  });
});

// ── runtime .ts compilation ─────────────────────────────────────────────────

// Descriptor template for .ts workflow compile tests — includes a dummy agent to pass V2 validation.
// Uses a noop stdio agent that handles the MCP initialize handshake.
function tsCompileDescriptor(module: string): string {
  return `
export default {
  tisyn_config: "workflow",
  run: { export: "myWorkflow", module: ${JSON.stringify(module)} },
  agents: [{ tisyn_config: "agent", id: "dummy", transport: { tisyn_config: "transport", kind: "stdio", command: "node", args: [${JSON.stringify(NOOP_AGENT)}] } }],
  journal: { tisyn_config: "journal", kind: "memory" },
};
`;
}

describe("runtime .ts workflow compilation", () => {
  it("tsn run compiles zero-param .ts workflow source", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
export function* myWorkflow() {
  return 42;
}
`,
      ),
    );

    yield* call(() => writeFile(join(dir, "descriptor.mjs"), tsCompileDescriptor("./workflow.ts")));

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs"), "--verbose"],
    }).join();

    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("42");
  });

  it("tsn run compiles .ts workflow source with input parameter", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
import type { Workflow } from "@tisyn/agent";

export function* myWorkflow(input: { maxTurns: number }): Workflow<number> {
  return input.maxTurns;
}
`,
      ),
    );

    yield* call(() => writeFile(join(dir, "descriptor.mjs"), tsCompileDescriptor("./workflow.ts")));

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs"), "--verbose", "--max-turns", "5"],
    }).join();

    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("5");
  });

  it("tsn run --help shows flags from .ts workflow source", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
import type { Workflow } from "@tisyn/agent";

export function* myWorkflow(input: { maxTurns: number; modelName?: string }): Workflow<void> {
  return;
}
`,
      ),
    );

    yield* call(() => writeFile(join(dir, "descriptor.mjs"), tsCompileDescriptor("./workflow.ts")));

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs"), "--help"],
    }).join();

    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("--max-turns");
    expect(result.stdout).toContain("--model-name");
  });

  it("tsn run accepts export { name } form", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
function* myWorkflow() {
  return 42;
}
export { myWorkflow };
`,
      ),
    );

    yield* call(() => writeFile(join(dir, "descriptor.mjs"), tsCompileDescriptor("./workflow.ts")));

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs"), "--verbose"],
    }).join();

    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("42");
  });

  it("tsn run rejects non-exported generator", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
export function* chat() {
  return 1;
}
function* helper() {
  return 0;
}
`,
      ),
    );

    // Descriptor points to non-exported "helper"
    yield* call(() =>
      writeFile(
        join(dir, "descriptor.mjs"),
        `
export default {
  tisyn_config: "workflow",
  run: { export: "helper", module: "./workflow.ts" },
  agents: [{ tisyn_config: "agent", id: "dummy", transport: { tisyn_config: "transport", kind: "stdio", command: "node", args: [${JSON.stringify(NOOP_AGENT)}] } }],
  journal: { tisyn_config: "journal", kind: "memory" },
};
`,
      ),
    );

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs")],
    }).join();

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("does not export");
  });

  it("tsn run rejects re-exported workflow with specific diagnostic", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
export function* local() {
  return 1;
}
export { chat } from "./other";
`,
      ),
    );

    // Descriptor points to re-exported "chat"
    yield* call(() =>
      writeFile(
        join(dir, "descriptor.mjs"),
        `
export default {
  tisyn_config: "workflow",
  run: { export: "chat", module: "./workflow.ts" },
  agents: [{ tisyn_config: "agent", id: "dummy", transport: { tisyn_config: "transport", kind: "stdio", command: "node", args: [${JSON.stringify(NOOP_AGENT)}] } }],
  journal: { tisyn_config: "journal", kind: "memory" },
};
`,
      ),
    );

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", join(dir, "descriptor.mjs")],
    }).join();

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("re-exported from another module");
  });
});

// ── TypeScript descriptor module loading ────────────────────────────────────

function tsDescriptorSource(opts?: { entrypoints?: boolean; sameModule?: boolean }): string {
  const agentJson = `{ tisyn_config: "agent", id: "dummy", transport: { tisyn_config: "transport", kind: "stdio", command: "node", args: [${JSON.stringify(NOOP_AGENT)}] } }`;
  if (opts?.sameModule) {
    // Descriptor with workflow export in the same module (no run.module)
    return `
export const myWorkflow = {
  tisyn: "fn",
  params: [],
  body: { tisyn: "eval", code: "Q(null)" },
};
export const inputSchemas = {
  myWorkflow: { type: "none" },
};
export default {
  tisyn_config: "workflow",
  run: { export: "myWorkflow" },
  agents: [${agentJson}],
  journal: { tisyn_config: "journal", kind: "memory" },
};
`;
  }
  let entrypoints = "";
  if (opts?.entrypoints) {
    entrypoints = `entrypoints: { dev: { tisyn_config: "entrypoint" }, staging: { tisyn_config: "entrypoint" } },`;
  }
  return `
export default {
  tisyn_config: "workflow",
  run: { export: "myWorkflow", module: "./workflow.generated.mjs" },
  agents: [${agentJson}],
  journal: { tisyn_config: "journal", kind: "memory" },
  ${entrypoints}
};
`;
}

function* writeTsFixture(
  dir: string,
  workflow: string,
  descriptorOpts?: { entrypoints?: boolean; sameModule?: boolean },
): Operation<string> {
  if (!descriptorOpts?.sameModule) {
    yield* call(() => writeFile(join(dir, "workflow.generated.mjs"), workflow));
  }
  const descriptorPath = join(dir, "descriptor.ts");
  yield* call(() => writeFile(descriptorPath, tsDescriptorSource(descriptorOpts)));
  return descriptorPath;
}

describe("TypeScript descriptor module loading", () => {
  it("tsn check accepts TypeScript descriptor + generated JS workflow", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeTsFixture(dir, FIXTURE_WORKFLOW_NONE);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", descriptorPath],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Check passed");
  });

  it("tsn check accepts TypeScript descriptor + generated JS workflow", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeTsFixture(dir, FIXTURE_WORKFLOW_NONE);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", descriptorPath],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Check passed");
  });

  it("tsn check compiles explicit TS workflow source", function* () {
    const dir = yield* call(makeTempDir);

    yield* call(() =>
      writeFile(
        join(dir, "workflow.ts"),
        `
export function* myWorkflow() {
  return 42;
}
`,
      ),
    );

    yield* call(() => writeFile(join(dir, "descriptor.mjs"), tsCompileDescriptor("./workflow.ts")));

    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", join(dir, "descriptor.mjs")],
    }).join();

    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Check passed");
  });

  it("TS descriptor with omitted run.module loads same-module export", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeTsFixture(dir, "", { sameModule: true });
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", descriptorPath],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Check passed");
  });

  it("existing JS descriptor workflow remains unchanged", function* () {
    const dir = yield* call(makeTempDir);
    const descriptorPath = yield* writeFixture(dir, FIXTURE_WORKFLOW_NONE);
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "check", descriptorPath],
    }).join();
    expect(result.code ?? 0).toBe(0);
    expect(result.stdout).toContain("Check passed");
  });

  it("missing .ts descriptor reports clear not-found diagnostic", function* () {
    const result = yield* exec("node", {
      arguments: [CLI_BIN, "run", "/tmp/nonexistent-tisyn-descriptor.ts"],
    }).join();
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("not found");
  });
});
