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

import { run } from "effection";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Call } from "@tisyn/ir";
import type { IrInput } from "@tisyn/ir";
import type { LocalCapability } from "./browser.js";

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
