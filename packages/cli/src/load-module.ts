/**
 * Shared bootstrap module loader for CLI-owned call sites.
 *
 * Loads modules via native `import()` (JavaScript) or `tsImport()` from
 * the `tsx` package (TypeScript). Used by descriptor loading, workflow
 * module loading, and transport binding loading.
 *
 * The `tsx/esm/api` module is imported lazily — only when a TypeScript-
 * family file is encountered — so JavaScript-only workflows never pay
 * the tsx startup cost.
 */

import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import { CliError } from "./load-descriptor.js";

const TS_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/** Check whether a file path has a TypeScript-family extension. */
export function isTypeScriptFile(filePath: string): boolean {
  return TS_EXTENSIONS.has(extname(filePath));
}

// Lazily cached tsx/esm/api module
let tsxApi:
  | { tsImport: (specifier: string, options: string | { parentURL: string }) => Promise<unknown> }
  | undefined;

async function getTsxApi() {
  if (!tsxApi) {
    try {
      tsxApi = (await import("tsx/esm/api")) as unknown as typeof tsxApi;
    } catch {
      throw new CliError(
        3,
        "TypeScript loader failed to initialize. Ensure @tisyn/cli dependencies are installed.",
      );
    }
  }
  return tsxApi!;
}

/**
 * Normalize CJS interop wrapping from tsx.
 *
 * When tsx loads a `.ts` file (ambiguous module type), it compiles to CJS
 * and wraps it as ESM. The result has `"module.exports"` as a key and
 * `mod.default` contains the real exports (named exports and, if present,
 * a nested `default` for the default export). `.mts` files are loaded as
 * native ESM and need no unwrapping.
 */
function normalizeTsxModule(mod: Record<string, unknown>): Record<string, unknown> {
  if ("module.exports" in mod && mod.default && typeof mod.default === "object") {
    return mod.default as Record<string, unknown>;
  }
  return mod;
}

/**
 * Load a module by absolute file path.
 *
 * Supports `.ts`, `.mts`, `.cts` (via tsx) and `.js`, `.mjs`, `.cjs`
 * (via native import). Rejects unsupported extensions with exit code 3.
 */
export async function loadModule(filePath: string): Promise<Record<string, unknown>> {
  const ext = extname(filePath);

  if (!TS_EXTENSIONS.has(ext) && !JS_EXTENSIONS.has(ext)) {
    throw new CliError(
      3,
      `Unsupported file extension '${ext}'. Supported: .ts, .mts, .cts, .js, .mjs, .cjs`,
    );
  }

  try {
    await access(filePath);
  } catch {
    throw new CliError(3, `Module not found: '${filePath}'`);
  }

  if (TS_EXTENSIONS.has(ext)) {
    const { tsImport } = await getTsxApi();
    try {
      const mod = (await tsImport(pathToFileURL(filePath).href, import.meta.url)) as Record<
        string,
        unknown
      >;
      return normalizeTsxModule(mod);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError(3, `Failed to load module '${filePath}': ${msg}`);
    }
  } else {
    try {
      return (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError(3, `Failed to load module '${filePath}': ${msg}`);
    }
  }
}
