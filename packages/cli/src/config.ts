import { access, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { call, type Operation } from "effection";
import ts from "typescript";
import type { TisynConfig, ResolvedPass } from "./types.js";

const PASS_NAME = /^[a-z][a-z0-9-]*$/;

export function* discoverConfig(startDir: string): Operation<string> {
  let current = resolve(startDir);
  while (true) {
    for (const name of ["tisyn.config.ts", "tisyn.config.json"]) {
      const candidate = resolve(current, name);
      try {
        yield* call(() => access(candidate));
        return candidate;
      } catch {}
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new ConfigError("No tisyn.config.ts or tisyn.config.json found");
    }
    current = parent;
  }
}

export function* loadConfig(configPath: string): Operation<TisynConfig> {
  if (configPath.endsWith(".json")) {
    const source = yield* call(() => readFile(configPath, "utf-8"));
    return JSON.parse(source) as TisynConfig;
  }

  if (!configPath.endsWith(".ts")) {
    throw new ConfigError(`Unsupported config file type: ${configPath}`);
  }

  const source = yield* call(() => readFile(configPath, "utf-8"));
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: configPath,
  }).outputText;

  // Write the transpiled file next to the original so node_modules resolution works.
  const tmpFile = configPath.replace(/\.ts$/, ".__tisyn_tmp__.mjs");
  try {
    yield* call(() => writeFile(tmpFile, transpiled));
    const mod = yield* call(() => import(pathToFileURL(tmpFile).href));
    return (mod.default ?? mod) as TisynConfig;
  } finally {
    yield* call(() => rm(tmpFile, { force: true }));
  }
}

export function* validateAndResolveConfig(
  config: TisynConfig,
  configPath: string,
): Operation<ResolvedPass[]> {
  if (!config || typeof config !== "object") {
    throw new ConfigError("Config must export an object");
  }

  if (!Array.isArray(config.generates) || config.generates.length === 0) {
    throw new ConfigError("'generates' must contain at least one pass");
  }

  const baseDir = dirname(configPath);
  const seenNames = new Set<string>();
  const resolved = config.generates.map((pass, index) => {
    if (!pass || typeof pass !== "object") {
      throw new ConfigError(`generates[${index}] must be an object`);
    }

    if (typeof pass.name !== "string" || !PASS_NAME.test(pass.name)) {
      throw new ConfigError(`Pass ${index + 1} has an invalid name`);
    }

    if (seenNames.has(pass.name)) {
      throw new ConfigError(`Duplicate pass name '${pass.name}'`);
    }
    seenNames.add(pass.name);

    if (typeof pass.input !== "string" || pass.input.length === 0) {
      throw new ConfigError(`Pass '${pass.name}' is missing 'input'`);
    }
    if (typeof pass.output !== "string" || pass.output.length === 0) {
      throw new ConfigError(`Pass '${pass.name}' is missing 'output'`);
    }

    const include = pass.include ?? [];
    if (!Array.isArray(include) || include.some((value) => typeof value !== "string")) {
      throw new ConfigError(`Pass '${pass.name}' has an invalid 'include' list`);
    }

    const dependsOn = pass.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((value) => typeof value !== "string")) {
      throw new ConfigError(`Pass '${pass.name}' has an invalid 'dependsOn' list`);
    }

    if (pass.format !== undefined && pass.format !== "printed" && pass.format !== "json") {
      throw new ConfigError(`Pass '${pass.name}' has an invalid format '${pass.format}'`);
    }

    return {
      name: pass.name,
      input: resolve(baseDir, pass.input),
      include: include.map((pattern) => pattern),
      output: resolve(baseDir, pass.output),
      format: pass.format ?? "printed",
      noValidate: pass.noValidate ?? false,
      dependsOn,
    } satisfies ResolvedPass;
  });

  for (const pass of resolved) {
    try {
      yield* call(() => access(pass.input));
    } catch {
      throw new ConfigError(`Pass '${pass.name}' input file not found: ${pass.input}`);
    }

    for (const dep of pass.dependsOn) {
      if (!seenNames.has(dep)) {
        throw new ConfigError(`Pass '${pass.name}' depends on unknown pass '${dep}'`);
      }
    }
  }

  return resolved;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
