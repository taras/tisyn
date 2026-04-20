/**
 * Adapter-side payload validators for CodeAgent operations.
 *
 * The CodeAgent contract declares each operation's payload shape as
 * a direct object (spec §7.1, §7.2). For operations whose payload
 * has only optional fields — notably `newSession`, declared as
 * `{ model?: string }` — the absence of any required field means a
 * malformed payload would otherwise be silently ignored. Adapters
 * MUST validate the declared shape at the boundary.
 */

const NEW_SESSION_ALLOWED_KEYS: readonly string[] = ["model"];

const EXPECTED_SHAPE = `{ model?: string }`;
const DISPATCH_HINT = `Dispatch the payload directly, for example { model: "..." }.`;

function fail(reason: string): never {
  const err = new Error(`newSession ${reason} Expected payload shape: ${EXPECTED_SHAPE}. ${DISPATCH_HINT}`);
  err.name = "InvalidPayload";
  throw err;
}

export function validateNewSessionPayload(payload: unknown): void {
  if (payload === null) {
    fail(`received null payload.`);
  }
  if (Array.isArray(payload)) {
    fail(`received array payload.`);
  }
  if (typeof payload !== "object") {
    fail(`received non-object payload (typeof '${typeof payload}').`);
  }

  const obj = payload as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!NEW_SESSION_ALLOWED_KEYS.includes(key)) {
      fail(`received unexpected payload key '${key}'.`);
    }
  }

  if ("model" in obj && typeof obj.model !== "string") {
    fail(`received non-string 'model' (typeof '${typeof obj.model}').`);
  }
}
