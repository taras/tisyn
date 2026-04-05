/**
 * Runtime context API — middleware-interceptable runtime capabilities.
 *
 * `Runtime` is a peer to `Effects` (from `@tisyn/agent`), created via
 * `createApi()`. It exposes `loadModule` as its first capability.
 *
 * Middleware semantics match `Effects.around()` exactly: scope-local,
 * inherited by children, child installations do not affect the parent.
 */

import { type Operation, call } from "effection";
import { createApi } from "@effectionx/context-api";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
import { loadModule as defaultLoadModule, ModuleLoadError } from "./load-module.js";

const RuntimeApi = createApi("Runtime", {
  *loadModule(specifier: string, parentURL: string): Operation<Record<string, unknown>> {
    const resolved = resolveSpecifier(specifier, parentURL);
    const filePath = fileURLToPath(resolved);
    return yield* call(() => defaultLoadModule(filePath));
  },
});

export const Runtime = Object.assign(RuntimeApi, {
  loadModule: RuntimeApi.operations.loadModule,
  around: RuntimeApi.around,
});

/**
 * Resolve a specifier against a parent URL to produce an absolute file: URL.
 *
 * Resolution rules:
 * - Absolute filesystem path → convert to file: URL
 * - file: URL string → parse as URL
 * - Relative path (./ or ../) → resolve against parentURL
 * - Bare specifier → throw ModuleLoadError
 */
function resolveSpecifier(specifier: string, parentURL: string): URL {
  if (specifier.startsWith("file:")) {
    return new URL(specifier);
  }
  if (isAbsolute(specifier)) {
    return pathToFileURL(specifier);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (!parentURL.startsWith("file:")) {
      throw new ModuleLoadError(
        `Cannot resolve relative specifier '${specifier}': parentURL '${parentURL}' is not a file: URL`,
      );
    }
    return new URL(specifier, parentURL);
  }
  throw new ModuleLoadError(
    `Bare specifier '${specifier}' is not supported. Use an absolute path, file: URL, or relative path (./ or ../).`,
  );
}
