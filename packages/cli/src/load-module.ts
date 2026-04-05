/**
 * CLI module loader — thin wrapper over @tisyn/runtime's shared loader.
 *
 * Delegates to the runtime-owned `loadModule()` for extension dispatch,
 * tsx loading, and CJS interop. Catches `ModuleLoadError` and wraps it
 * as `CliError(3)` for CLI exit-code semantics.
 */

import { loadModule as runtimeLoadModule, isTypeScriptFile, ModuleLoadError } from "@tisyn/runtime";
import { CliError } from "./load-descriptor.js";

export { isTypeScriptFile };

/**
 * Load a module by absolute file path.
 *
 * Supports `.ts`, `.mts`, `.cts` (via tsx) and `.js`, `.mjs`, `.cjs`
 * (via native import). Rejects unsupported extensions with exit code 3.
 */
export async function loadModule(filePath: string): Promise<Record<string, unknown>> {
  try {
    return await runtimeLoadModule(filePath);
  } catch (err) {
    if (err instanceof ModuleLoadError) {
      throw new CliError(3, err.message);
    }
    throw err;
  }
}
