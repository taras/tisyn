/**
 * Tests for @tisyn/cli operations.
 *
 * Uses @effectionx/vitest for generator-based test bodies (Operations).
 * Each test that exercises an Effection operation runs inside a managed scope.
 */

import { describe, it } from "@effectionx/vitest";
import { expect, afterEach } from "vitest";
import { call } from "effection";
import { exec } from "@effectionx/process";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topoSort, runGenerate, runBuild } from "./compile.js";
import { discoverConfig, validateAndResolveConfig, ConfigError } from "./config.js";

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
});
