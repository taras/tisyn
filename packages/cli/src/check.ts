/**
 * `tsn check` command — validate descriptor readiness without executing.
 *
 * Runs phases A-C of the startup lifecycle:
 * A. Load and validate descriptor
 * B. Resolve workflow module + input schema
 * C. Resolve environment variables
 *
 * Does NOT start transports, servers, or execute workflows.
 */

import { resolve } from "node:path";
import { exit } from "effection";
import type { Operation } from "effection";
import { collectEnvNodes } from "@tisyn/config";
import { applyOverlay, resolveEnv, ConfigError } from "@tisyn/runtime";
import {
  loadDescriptorModule,
  resolveWorkflowModule,
  resolveWorkflowExport,
  loadWorkflowExport,
} from "./load-descriptor.js";
import { deriveFlags, formatInputHelp } from "./inputs.js";
import type { CheckCommandOptions } from "./types.js";

export function* runCheck(options: CheckCommandOptions, cwd: string): Operation<void> {
  const modulePath = resolve(cwd, options.module);

  // Phase A: Load and validate descriptor
  const descriptor = yield* loadDescriptorModule(modulePath);

  // Apply entrypoint overlay if specified
  const merged = options.entrypoint ? applyOverlay(descriptor, options.entrypoint) : descriptor;

  // Phase B: Resolve workflow module + export
  const {
    modulePath: workflowPath,
    exportName,
    explicit,
  } = resolveWorkflowModule(merged, modulePath);
  const workflowExport = explicit
    ? yield* resolveWorkflowExport(workflowPath, exportName)
    : yield* loadWorkflowExport(workflowPath, exportName);

  // Phase C: Resolve environment
  const envNodes = collectEnvNodes(merged);

  // --env-example: print env template and exit
  if (options.envExample) {
    if (envNodes.length === 0) {
      console.log("# No environment variables required");
    } else {
      for (const node of envNodes) {
        const mode =
          node.mode === "optional"
            ? "(optional)"
            : node.mode === "secret"
              ? "(secret)"
              : "(required)";
        const defaultVal = "default" in node ? ` # default: ${node.default}` : "";
        console.log(`${node.name}=${mode}${defaultVal}`);
      }
    }
    return;
  }

  try {
    resolveEnv(envNodes, process.env as Record<string, string>);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Environment check failed:\n${err.message}`);
      yield* exit(5);
      return;
    }
    throw err;
  }

  // Advisory: print input schema summary
  if (!workflowExport.inputSchema) {
    console.warn("Warning: workflow module does not export input schema metadata");
  } else if (workflowExport.inputSchema.type === "unsupported") {
    console.warn(
      `Warning: workflow input parameters are unsupported: ${workflowExport.inputSchema.reason}`,
    );
  } else if (workflowExport.inputSchema.type === "object") {
    const flags = deriveFlags(workflowExport.inputSchema);
    if (flags.length > 0) {
      console.log(formatInputHelp(flags));
    }
  }

  console.log("Check passed: descriptor is valid and ready to run");
}
