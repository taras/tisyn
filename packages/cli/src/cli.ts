#!/usr/bin/env node

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { exit, main } from "effection";
import { cli, commands, field, object, program } from "configliere";
import { runBuild, runGenerate, formatCompileError } from "./compile.js";
import { ConfigError, discoverConfig, loadConfig, validateAndResolveConfig } from "./config.js";
import {
  booleanSchema,
  enumSchema,
  optionalStringSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { BuildCommandOptions, GenerateCommandOptions } from "./types.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

const app = program({
  name: "tsn",
  version,
  config: commands({
    generate: {
      description: "generate one workflow module",
      ...object({
        input: {
          description: "declaration file",
          ...field(stringSchema, cli.argument()),
        },
        include: {
          description: "additional workflow file glob",
          aliases: ["-i"],
          ...field(stringArraySchema, field.array(), field.default([])),
        },
        output: {
          description: "output file path",
          aliases: ["-o"],
          ...field(optionalStringSchema),
        },
        format: {
          description: "workflow output format",
          ...field(enumSchema(["printed", "json"] as const), field.default("printed")),
        },
        validate: {
          description: "validate generated IR",
          ...field(booleanSchema, field.default(true)),
        },
        verbose: {
          description: "show detailed diagnostics",
          ...field(booleanSchema, field.default(false)),
        },
      }),
    },
    build: {
      description: "run config-driven generation passes",
      ...object({
        config: {
          description: "path to tisyn config file",
          aliases: ["-c"],
          ...field(optionalStringSchema),
        },
        filter: {
          description: "run only the named pass and its dependencies",
          ...field(optionalStringSchema),
        },
        verbose: {
          description: "show detailed diagnostics",
          ...field(booleanSchema, field.default(false)),
        },
      }),
    },
  }),
});

await main(function* () {
  const input = {
    args: process.argv.slice(2),
    envs: [{ name: "env", value: normalizeEnv(process.env) }],
  };
  const parsed = app.parse(input);

  if (!parsed.ok) {
    console.error(parsed.error.message);
    yield* exit(2);
    return;
  }

  if (parsed.value.help) {
    console.log(app.help(input));
    return;
  }

  if (parsed.value.version) {
    console.log(version);
    return;
  }

  const command = parsed.value.config;

  if (command.help) {
    console.log(command.text);
    return;
  }

  try {
    switch (command.name) {
      case "generate":
        yield* runGenerate(command.config as GenerateCommandOptions, process.cwd());
        break;
      case "build": {
        const options = command.config as BuildCommandOptions;
        const configPath = options.config
          ? resolve(process.cwd(), options.config)
          : yield* discoverConfig(process.cwd());
        const config = yield* loadConfig(configPath);
        const passes = yield* validateAndResolveConfig(config, configPath);
        yield* runBuild(passes, options, dirname(configPath));
        break;
      }
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      yield* exit(2);
      return;
    }

    if (error instanceof Error) {
      console.error(formatCompileError(error));
      yield* exit(1);
      return;
    }

    console.error(String(error));
    yield* exit(3);
  }
});

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const scoped: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (key.startsWith("TISYN_")) {
      scoped[key.slice("TISYN_".length)] = value;
    }
  }
  return scoped;
}
