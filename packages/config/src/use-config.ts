import type { ConfigToken } from "./types.js";

/**
 * Access the resolved config projection inside a workflow.
 *
 * The token argument provides static typing — it is erased by the compiler.
 * At runtime, the active resolved config projection is returned from
 * the runtime ConfigContext via the __config effect.
 */
function* useConfig<T>(_token: ConfigToken<T>): Generator<unknown, T, unknown> {
  throw new Error(
    "Config.useConfig() must be compiled by the Tisyn compiler. " +
      "Direct invocation is not supported.",
  );
}

export const Config = { useConfig } as const;
