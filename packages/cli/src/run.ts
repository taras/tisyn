/**
 * `tsn run` command — config-aware workflow execution.
 *
 * Full startup lifecycle:
 * A. Load and validate descriptor
 * B. Derive and validate inputs from CLI flags
 * C. Resolve environment
 * D. Start resources (journal, transports, server) and execute workflow
 */

import { resolve } from "node:path";
import { call, exit, spawn } from "effection";
import type { Operation } from "effection";
import { collectEnvNodes } from "@tisyn/config";
import {
  applyOverlay,
  resolveEnv,
  resolveConfig,
  execute,
  ConfigError as RuntimeConfigError,
} from "@tisyn/runtime";
import {
  loadDescriptorModule,
  resolveWorkflowModule,
  loadWorkflowExport,
  CliError,
} from "./load-descriptor.js";
import { deriveFlags, parseInputFlags, formatInputHelp } from "./inputs.js";
import { installAllTransports, createJournalStream, startServer } from "./startup.js";
import type { RunCommandOptions } from "./types.js";

export function* runRun(
  options: RunCommandOptions,
  cwd: string,
  extraArgv: string[],
): Operation<void> {
  const modulePath = resolve(cwd, options.module);

  // Phase A: Load and validate descriptor
  const descriptor = yield* call(() => loadDescriptorModule(modulePath));
  const merged = options.entrypoint ? applyOverlay(descriptor, options.entrypoint) : descriptor;

  // Phase B: Derive and validate inputs
  const { modulePath: workflowPath, exportName } = resolveWorkflowModule(merged, modulePath);
  const workflowExport = yield* call(() => loadWorkflowExport(workflowPath, exportName));

  let inputFlags: FlagInfo = { flags: [], parsed: {} };
  if (workflowExport.inputSchema) {
    const flags = deriveFlags(workflowExport.inputSchema);
    if (flags.length > 0) {
      const parsed = parseInputFlags(flags, extraArgv);
      inputFlags = { flags, parsed };
    }
  }

  // Phase C: Resolve environment
  let resolvedProjection;
  try {
    resolvedProjection = resolveConfig(merged, {
      entrypoint: options.entrypoint,
      processEnv: process.env as Record<string, string>,
    });
  } catch (err) {
    if (err instanceof RuntimeConfigError) {
      console.error(`Environment resolution failed:\n${err.message}`);
      yield* exit(5);
      return;
    }
    throw err;
  }

  // Phase D: Start resources and execute
  const stream = createJournalStream(resolvedProjection.journal);

  // Install agent transports
  yield* installAllTransports(resolvedProjection);

  // Start server if present
  if (resolvedProjection.server) {
    yield* spawn(function* () {
      yield* startServer(resolvedProjection.server!);
    });
  }

  // Execute workflow
  const { result } = yield* execute({
    ir: workflowExport.ir,
    env: inputFlags.parsed as never,
    config: resolvedProjection as unknown as Record<string, unknown>,
    stream,
  });

  if (result.status === "ok") {
    if (options.verbose && result.value !== null && result.value !== undefined) {
      console.log(JSON.stringify(result.value, null, 2));
    }
  } else if (result.status === "err") {
    console.error(`Workflow execution failed: ${result.error.message}`);
    yield* exit(6);
  } else {
    console.error("Workflow execution was cancelled");
    yield* exit(6);
  }
}

interface FlagInfo {
  flags: ReturnType<typeof deriveFlags>;
  parsed: Record<string, unknown>;
}
