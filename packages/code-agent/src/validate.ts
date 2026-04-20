/**
 * Adapter-side payload validators for CodeAgent operations.
 *
 * The CodeAgent contract declares each operation's payload shape as
 * a direct object (spec §7.1, §7.2). For operations whose payload
 * has only optional fields — notably `newSession`, declared as
 * `{ model?: string }` — the absence of any required field means an
 * unrecognized payload key would otherwise be silently ignored.
 * Adapters MUST reject unknown keys explicitly so the declared shape
 * is enforced at the boundary.
 */

const NEW_SESSION_ALLOWED_KEYS: readonly string[] = ["model"];

export function validateNewSessionPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!NEW_SESSION_ALLOWED_KEYS.includes(key)) {
      const err = new Error(
        `newSession received unexpected payload key '${key}'. ` +
          `Expected payload shape: { model?: string }. ` +
          `Dispatch the payload directly, for example { model: "..." }.`,
      );
      err.name = "InvalidPayload";
      throw err;
    }
  }
}
