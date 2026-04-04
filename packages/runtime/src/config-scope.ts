/**
 * Runtime-owned config-scope abstraction.
 *
 * Manages the execution-scoped resolved config projection. The config
 * is seeded once at the start of execution and read by __config effect
 * dispatch. The underlying context mechanism is an implementation detail
 * — callers use provideConfig() and readConfig() instead of touching
 * the context directly.
 *
 * This module is internal to @tisyn/runtime. It is not re-exported
 * from the package public surface.
 */

import type { Operation } from "effection";
import { createContext } from "effection";
import type { Val } from "@tisyn/ir";

const ConfigContext = createContext<Record<string, unknown> | null>("$config", null);

/**
 * Seed the resolved config projection into the current execution scope.
 *
 * Called once at the start of execute(). The config value is inherited
 * by all child scopes within the execution.
 */
export function provideConfig(config: Record<string, unknown> | null) {
  return ConfigContext.set(config);
}

/**
 * Read the resolved config projection from the current execution scope.
 *
 * Used by __config effect dispatch to return the config to workflow code.
 * Returns the config as a Val (the runtime value type), or null if no
 * config was provided.
 */
export function readConfig() {
  return ConfigContext.get() as Operation<Val>;
}
