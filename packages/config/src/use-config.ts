import type { ConfigToken } from "./types.js";

/**
 * Access the resolved config projection inside a workflow.
 *
 * The token argument provides static typing — it is erased by the compiler.
 * At runtime, the active resolved config projection is returned from
 * ExecuteOptions.config via the __config effect.
 */
export function* useConfig<T>(_token: ConfigToken<T>): Generator<unknown, T, unknown> {
  throw new Error(
    "useConfig() must be compiled by the Tisyn compiler. " + "Direct invocation is not supported.",
  );
}
