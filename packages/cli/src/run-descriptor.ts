/**
 * Programmatic workflow driver — factored out of `tsn run`'s Phase D.
 *
 * Loads a workflow descriptor module, starts its resources (journal stream,
 * server if declared, local/inprocess transports), executes the workflow,
 * and then invokes the caller-supplied continuation with the workflow's
 * final value while all resources remain alive. Resources are torn down
 * when the continuation returns.
 *
 * This exists so examples (e.g. the deterministic-peer-loop example's
 * `main.ts`) can keep the WebSocket server alive past `execute()`'s return
 * — needed for "replay-only completed run" hydration where no live
 * workflow dispatch ever occurs.
 */

import { dirname } from "node:path";
import type { Operation } from "effection";
import type { FnNode, IrInput, Val } from "@tisyn/ir";
import { Call, isFnNode } from "@tisyn/ir";
import { applyOverlay, resolveConfig } from "@tisyn/runtime";
import { execute } from "@tisyn/runtime";
import type { LocalServerBinding } from "@tisyn/transport";
import {
  CliError,
  loadDescriptorModule,
  loadWorkflowExport,
  resolveWorkflowExport,
  resolveWorkflowModule,
} from "./load-descriptor.js";
import { createJournalStream, installAllTransports, startServer } from "./startup.js";
import { rebaseConfigPaths } from "./run.js";

export interface RunDescriptorOptions {
  /** Optional entrypoint overlay name (e.g. "dev"). */
  entrypoint?: string;
}

/**
 * Load a workflow descriptor module, start its resources, execute the
 * workflow, then run `continuation` with the workflow's final return value.
 * The server/transports/journal remain alive until the continuation returns.
 *
 * Only supports zero-parameter workflows. Callers that need input parameters
 * should drive through the CLI.
 */
export function* runDescriptorLocally(
  modulePath: string,
  continuation: (finalValue: Val) => Operation<void>,
  options?: RunDescriptorOptions,
): Operation<void> {
  const descriptor = yield* loadDescriptorModule(modulePath);
  const merged = options?.entrypoint ? applyOverlay(descriptor, options.entrypoint) : descriptor;

  const {
    modulePath: workflowPath,
    exportName,
    explicit,
  } = resolveWorkflowModule(merged, modulePath);
  const workflowExport = explicit
    ? yield* resolveWorkflowExport(workflowPath, exportName)
    : yield* loadWorkflowExport(workflowPath, exportName);

  const resolvedProjection = resolveConfig(descriptor, {
    entrypoint: options?.entrypoint,
    processEnv: process.env as Record<string, string>,
  });

  rebaseConfigPaths(resolvedProjection, dirname(modulePath));

  const stream = createJournalStream(resolvedProjection.journal);

  let serverBinding: LocalServerBinding | undefined;
  if (resolvedProjection.server) {
    serverBinding = yield* startServer(resolvedProjection.server);
  }

  yield* installAllTransports(resolvedProjection, serverBinding);

  let executableIr: IrInput;
  if (isFnNode(workflowExport.ir)) {
    const fn = workflowExport.ir as FnNode;
    if (fn.params.length !== 0) {
      throw new CliError(
        2,
        "runDescriptorLocally only supports zero-parameter workflows; use `tsn run` for parametric workflows",
      );
    }
    executableIr = Call(fn);
  } else {
    executableIr = workflowExport.ir;
  }

  const execEnv: Record<string, unknown> = workflowExport.runtimeBindings
    ? { ...workflowExport.runtimeBindings }
    : {};

  const { result } = yield* execute({
    ir: executableIr,
    env: execEnv as never,
    config: resolvedProjection as unknown as Val,
    stream,
  });

  if (result.status === "error") {
    throw new Error(`Workflow execution failed: ${result.error.message}`);
  }
  if (result.status === "cancelled") {
    throw new Error("Workflow execution was cancelled");
  }

  yield* continuation(result.value);
}
