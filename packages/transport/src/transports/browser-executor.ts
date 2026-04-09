/**
 * Browser executor setup — runs INSIDE the browser page.
 *
 * This module is meant to be imported in user executor scripts
 * and bundled into an IIFE for browser injection. It is NOT
 * imported by the transport itself (to avoid circular deps).
 *
 * @example
 * ```typescript
 * // my-executor.ts — bundle this into an IIFE
 * import { createBrowserExecutor } from "@tisyn/transport/browser-executor";
 * import { localCapability } from "@tisyn/transport/browser";
 * import { Dom, createDomHandlers } from "./my-dom-agent";
 *
 * createBrowserExecutor([
 *   localCapability(Dom, createDomHandlers()),
 * ]);
 * ```
 */

import type { Operation } from "effection";
import { run } from "effection";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Call } from "@tisyn/ir";
import type { IrInput, Json } from "@tisyn/ir";
import type { InProcessRunner, LocalCapability } from "./browser.js";

/**
 * Create an in-process runner for browserTransport's in-process mode.
 *
 * The returned function evaluates workflow IR using the full
 * `@tisyn/runtime` — the same semantics the browser executor uses
 * in-page. Pass it as the `run` config field of `browserTransport()`.
 *
 * @example
 * ```typescript
 * import { browserTransport, localCapability } from "@tisyn/transport/browser";
 * import { createInProcessRunner } from "@tisyn/transport/browser-executor";
 *
 * const transport = browserTransport({
 *   capabilities: [localCapability(MyAgent, handlers)],
 *   run: createInProcessRunner(),
 * });
 * ```
 */
export function createInProcessRunner(): InProcessRunner {
  return function* (workflow: IrInput): Operation<Json> {
    const stream = new InMemoryStream();
    const { result } = yield* execute({
      ir: Call(workflow as any) as IrInput,
      stream,
    });
    if (result.status === "error") {
      throw new Error((result as any).error?.message ?? "Browser execute failed");
    }
    return (result as any).value as Json;
  };
}

/**
 * Create a browser executor that runs inside the browser page.
 *
 * Defines `window.__tisyn_execute(ir)` which installs the configured
 * capabilities before each IR execution.
 */
export function createBrowserExecutor(capabilities: LocalCapability[]): void {
  (globalThis as any).__tisyn_execute = (
    ir: IrInput,
  ): Promise<{ status: string; value?: unknown; error?: { message: string } }> => {
    return run(function* () {
      for (const cap of capabilities) {
        yield* cap();
      }
      const stream = new InMemoryStream();
      const { result } = yield* execute({
        ir: Call(ir as any) as IrInput,
        stream,
      });
      return result;
    });
  };
}
