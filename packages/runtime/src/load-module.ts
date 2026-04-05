/**
 * Shared default module loader.
 *
 * Loads modules via native `import()` (JavaScript) or `tsImport()` from
 * the `tsx` package (TypeScript). Used by the `Runtime.loadModule` core
 * handler and by CLI bootstrap loading (pre-scope).
 *
 * The `tsx/esm/api` module is imported lazily — only when a TypeScript-
 * family file is encountered — so JavaScript-only workflows never pay
 * the tsx startup cost.
 */

import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

// ── Error hierarchy ──────────────────────────────────────────────────────────

/** Base error for module loading failures. */
export class ModuleLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleLoadError";
  }
}

/** Thrown when the file extension is not in the supported set. */
export class UnsupportedExtensionError extends ModuleLoadError {
  constructor(ext: string) {
    super(
      `Unsupported file extension '${ext}'. Supported: .ts, .mts, .cts, .js, .mjs, .cjs`,
    );
    this.name = "UnsupportedExtensionError";
  }
}

/** Thrown when the target file does not exist. */
export class ModuleNotFoundError extends ModuleLoadError {
  constructor(filePath: string) {
    super(`Module not found: '${filePath}'`);
    this.name = "ModuleNotFoundError";
  }
}

/** Thrown when the tsx/esm/api loader fails to initialize. */
export class LoaderInitError extends ModuleLoadError {
  constructor() {
    super(
      "TypeScript loader failed to initialize. Ensure @tisyn/runtime dependencies are installed.",
    );
    this.name = "LoaderInitError";
  }
}

// ── Extension sets ───────────────────────────────────────────────────────────

const TS_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/** Check whether a file path has a TypeScript-family extension. */
export function isTypeScriptFile(filePath: string): boolean {
  return TS_EXTENSIONS.has(extname(filePath));
}

// ── Lazy tsx cache ───────────────────────────────────────────────────────────

let tsxApi:
  | { tsImport: (specifier: string, options: string | { parentURL: string }) => Promise<unknown> }
  | undefined;

async function getTsxApi() {
  if (!tsxApi) {
    try {
      tsxApi = (await import("tsx/esm/api")) as unknown as typeof tsxApi;
    } catch {
      throw new LoaderInitError();
    }
  }
  return tsxApi!;
}

// ── CJS interop ──────────────────────────────────────────────────────────────

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

// ── Public loader ────────────────────────────────────────────────────────────

/**
 * Load a module by absolute file path.
 *
 * Supports `.ts`, `.mts`, `.cts` (via tsx) and `.js`, `.mjs`, `.cjs`
 * (via native import). Throws `ModuleLoadError` subclasses on failure.
 */
export async function loadModule(filePath: string): Promise<Record<string, unknown>> {
  const ext = extname(filePath);

  if (!TS_EXTENSIONS.has(ext) && !JS_EXTENSIONS.has(ext)) {
    throw new UnsupportedExtensionError(ext);
  }

  try {
    await access(filePath);
  } catch {
    throw new ModuleNotFoundError(filePath);
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
      throw new ModuleLoadError(`Failed to load module '${filePath}': ${msg}`);
    }
  } else {
    try {
      return (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ModuleLoadError(`Failed to load module '${filePath}': ${msg}`);
    }
  }
}
