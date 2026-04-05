export interface ConfigValidationError {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

export type ConfigValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly ConfigValidationError[] };

const RECOGNIZED_DISCRIMINANTS = new Set([
  "workflow",
  "agent",
  "transport",
  "env",
  "journal",
  "entrypoint",
  "server",
]);

const ENTRYPOINT_KEY_RE = /^[a-z][a-z0-9-]*$/;

const REQUIRED_TRANSPORT_FIELDS: Record<string, string[]> = {
  worker: ["url"],
  local: ["module"],
  stdio: ["command"],
  websocket: ["url"],
  inprocess: ["module"],
};

export function validateConfig(descriptor: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const seen = new WeakSet<object>();
  walk(descriptor, "", errors, seen);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Single-pass recursive walk. At each node:
 * 1. Check V8 (serializable domain) for the current value
 * 2. If it's a tisyn_config node, run node-specific validation
 * 3. Recurse into all children
 */
function walk(
  value: unknown,
  path: string,
  errors: ConfigValidationError[],
  seen: WeakSet<object>,
): void {
  // V8: primitives
  if (value === undefined) {
    errors.push({ rule: "V8", path, message: "undefined is not in the serializable data domain" });
    return;
  }
  if (value === null) {
    return;
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      errors.push({ rule: "V8", path, message: `${value} is not in the serializable data domain` });
    }
    return;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    errors.push({
      rule: "V8",
      path,
      message: `${typeof value} is not in the serializable data domain`,
    });
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  // V8: non-plain objects
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof ArrayBuffer
  ) {
    errors.push({
      rule: "V8",
      path,
      message: `${value.constructor.name} is not in the serializable data domain`,
    });
    return;
  }

  // V8: circular reference (stack-based: detects actual cycles, not shared references)
  if (seen.has(value)) {
    errors.push({ rule: "V8", path, message: "Circular reference detected" });
    return;
  }
  seen.add(value);
  // Defined here so we can delete after recursion (at end of function)
  const removeFromSeen = () => seen.delete(value);

  // V8: class instances and Symbol keys (non-array objects only)
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      errors.push({
        rule: "V8",
        path,
        message: "Class instances are not in the serializable data domain",
      });
      return;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      errors.push({
        rule: "V8",
        path,
        message: "Symbol keys are not in the serializable data domain",
      });
      return;
    }
  }

  const obj = value as Record<string, unknown>;

  // V9: no node with both tisyn_config and tisyn
  if ("tisyn_config" in obj && "tisyn" in obj) {
    errors.push({
      rule: "V9",
      path,
      message: "Node must not carry both 'tisyn_config' and 'tisyn' fields",
    });
  }

  // Node-specific validation for tisyn_config nodes
  if ("tisyn_config" in obj) {
    // V1: recognized discriminant
    if (!RECOGNIZED_DISCRIMINANTS.has(obj.tisyn_config as string)) {
      errors.push({
        rule: "V1",
        path,
        message: `Unrecognized tisyn_config value: '${String(obj.tisyn_config)}'`,
      });
    } else {
      const kind = obj.tisyn_config as string;
      if (kind === "workflow") {
        validateWorkflowRules(obj, path, errors);
      } else if (kind === "agent") {
        validateAgentRules(obj, path, errors);
      } else if (kind === "transport") {
        validateTransportRules(obj, path, errors);
      } else if (kind === "env") {
        validateEnvRules(obj, path, errors);
      }
    }
  }

  // Recurse into all children
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], p(path, `[${i}]`), errors, seen);
    }
  } else {
    for (const key of Object.keys(obj)) {
      walk(obj[key], p(path, key), errors, seen);
    }
  }

  // Remove from ancestor stack so shared references (non-cycles) aren't rejected
  removeFromSeen();
}

function validateWorkflowRules(
  obj: Record<string, unknown>,
  path: string,
  errors: ConfigValidationError[],
): void {
  // V2: run field
  const run = obj.run;
  if (run == null) {
    errors.push({ rule: "V2", path: p(path, "run"), message: "Missing 'run' field" });
  } else if (typeof run === "string") {
    if (run === "") {
      errors.push({
        rule: "V2",
        path: p(path, "run"),
        message: "'run' must be a non-empty string",
      });
    }
  } else if (typeof run === "object" && run !== null) {
    const ref = run as Record<string, unknown>;
    if (typeof ref.export !== "string" || ref.export === "") {
      errors.push({
        rule: "V2",
        path: p(path, "run.export"),
        message: "'run.export' must be a non-empty string",
      });
    }
  }

  // V2: agents
  const agents = obj.agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    errors.push({
      rule: "V2",
      path: p(path, "agents"),
      message: "'agents' must be a non-empty array",
    });
  } else {
    // V4: unique agent ids
    const ids = new Set<string>();
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i] as Record<string, unknown>;
      if (a != null && typeof a === "object" && typeof a.id === "string" && a.id !== "") {
        if (ids.has(a.id)) {
          errors.push({
            rule: "V4",
            path: p(path, `agents[${i}].id`),
            message: `Duplicate agent id: '${a.id}'`,
          });
        }
        ids.add(a.id);
      }
    }
  }

  // V10: base WorkflowDescriptor must NOT have server
  if ("server" in obj) {
    errors.push({
      rule: "V10",
      path: p(path, "server"),
      message: "Base WorkflowDescriptor must not include a 'server' field",
    });
  }

  // V7: entrypoint key format
  if (
    obj.entrypoints != null &&
    typeof obj.entrypoints === "object" &&
    !Array.isArray(obj.entrypoints)
  ) {
    const entries = obj.entrypoints as Record<string, unknown>;
    for (const key of Object.keys(entries)) {
      if (!ENTRYPOINT_KEY_RE.test(key)) {
        errors.push({
          rule: "V7",
          path: p(path, `entrypoints.${key}`),
          message: `Entrypoint key '${key}' must match [a-z][a-z0-9-]*`,
        });
      }
    }
  }
}

function validateAgentRules(
  obj: Record<string, unknown>,
  path: string,
  errors: ConfigValidationError[],
): void {
  // V3: non-empty id
  if (typeof obj.id !== "string" || obj.id === "") {
    errors.push({
      rule: "V3",
      path: p(path, "id"),
      message: "Agent 'id' must be a non-empty string",
    });
  }

  // V3: valid transport
  if (obj.transport == null) {
    errors.push({
      rule: "V3",
      path: p(path, "transport"),
      message: "Agent must have a 'transport'",
    });
  }
}

function validateTransportRules(
  obj: Record<string, unknown>,
  path: string,
  errors: ConfigValidationError[],
): void {
  // V5: kind field
  if (typeof obj.kind !== "string" || obj.kind === "") {
    errors.push({
      rule: "V5",
      path: p(path, "kind"),
      message: "Transport must have a 'kind' field",
    });
    return;
  }

  // V5: required fields for built-in kinds
  const required = REQUIRED_TRANSPORT_FIELDS[obj.kind];
  if (required) {
    for (const field of required) {
      if (obj[field] == null) {
        errors.push({
          rule: "V5",
          path: p(path, field),
          message: `Transport kind '${obj.kind}' requires field '${field}'`,
        });
      }
    }
  }
}

function validateEnvRules(
  obj: Record<string, unknown>,
  path: string,
  errors: ConfigValidationError[],
): void {
  const mode = obj.mode;

  // V6
  if (mode === "optional" && !("default" in obj)) {
    errors.push({ rule: "V6", path, message: "Optional env must have a 'default' field" });
  }
  if (mode === "required" && "default" in obj) {
    errors.push({ rule: "V6", path, message: "Required env must not have a 'default' field" });
  }
  if (mode === "secret" && "default" in obj) {
    errors.push({ rule: "V6", path, message: "Secret env must not have a 'default' field" });
  }
}

function p(base: string, segment: string): string {
  return base === "" ? segment : `${base}.${segment}`;
}
