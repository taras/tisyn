import type {
  WorkflowDescriptor,
  AgentBinding,
  EntrypointDescriptor,
  EnvDescriptor,
  JournalDescriptor,
  ServerDescriptor,
} from "@tisyn/config";
import { validateConfig, collectEnvNodes } from "@tisyn/config";

// ── Types ──

export interface ResolveConfigOptions {
  /** Named entrypoint to apply as overlay. */
  entrypoint?: string;
  /** Process environment to resolve env nodes from. Defaults to process.env. */
  processEnv?: Record<string, string | undefined>;
}

export interface ResolvedConfig {
  agents: ResolvedAgent[];
  journal: ResolvedJournal;
  server?: ResolvedServer;
}

export interface ResolvedAgent {
  id: string;
  transport: Record<string, unknown>;
}

export interface ResolvedJournal {
  kind: string;
  path?: string;
}

export interface ResolvedServer {
  kind: string;
  port: number;
  static?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ── Overlay Application (§7.3) ──

export function applyOverlay(
  base: WorkflowDescriptor,
  entrypointName?: string,
): WorkflowDescriptor {
  if (!entrypointName) return base;

  const entrypoints = base.entrypoints;
  if (!entrypoints || !(entrypointName in entrypoints)) {
    throw new ConfigError(`Entrypoint '${entrypointName}' not found in descriptor`);
  }

  const overlay = entrypoints[entrypointName];
  return mergeOverlay(base, overlay);
}

function mergeOverlay(
  base: WorkflowDescriptor,
  overlay: EntrypointDescriptor,
): WorkflowDescriptor {
  // Agents: merge by id
  const mergedAgents = mergeAgents(
    base.agents as AgentBinding[],
    overlay.agents as AgentBinding[] | undefined,
  );

  // Journal: full replacement
  const mergedJournal = overlay.journal ?? base.journal;

  // Server: additive (base has none, entrypoint introduces one)
  const mergedServer = overlay.server;

  const result: Record<string, unknown> = {
    tisyn_config: "workflow",
    run: base.run,
    agents: mergedAgents,
  };
  if (mergedJournal != null) result.journal = mergedJournal;
  if (base.entrypoints != null) result.entrypoints = base.entrypoints;
  if (mergedServer != null) result.server = mergedServer;

  return result as unknown as WorkflowDescriptor;
}

function mergeAgents(
  baseAgents: AgentBinding[],
  overlayAgents?: AgentBinding[],
): AgentBinding[] {
  if (!overlayAgents || overlayAgents.length === 0) return [...baseAgents];

  const overlayById = new Map<string, AgentBinding>();
  for (const a of overlayAgents) {
    overlayById.set(a.id, a);
  }

  // Retain base agents in order, replacing matched ones
  const result: AgentBinding[] = [];
  const replaced = new Set<string>();
  for (const base of baseAgents) {
    const replacement = overlayById.get(base.id);
    if (replacement) {
      result.push(replacement);
      replaced.add(base.id);
    } else {
      result.push(base);
    }
  }

  // Append overlay agents with ids not in base
  for (const a of overlayAgents) {
    if (!replaced.has(a.id) && !baseAgents.some((b) => b.id === a.id)) {
      result.push(a);
    }
  }

  return result;
}

// ── Env Resolution (§5.4, §7.1 steps 5-6) ──

export function resolveEnv(
  nodes: EnvDescriptor[],
  processEnv: Record<string, string | undefined>,
): Map<EnvDescriptor, string | number | boolean> {
  const missing: string[] = [];
  const resolved = new Map<EnvDescriptor, string | number | boolean>();

  for (const node of nodes) {
    const raw = processEnv[node.name];

    if (node.mode === "optional") {
      if (raw != null) {
        resolved.set(node, coerce(raw, node.default, node.name));
      } else {
        resolved.set(node, node.default);
      }
    } else {
      // required or secret
      if (raw == null) {
        missing.push(node.name);
      } else {
        resolved.set(node, raw);
      }
    }
  }

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    );
  }

  return resolved;
}

function coerce(raw: string, defaultValue: string | number | boolean, name: string): string | number | boolean {
  if (typeof defaultValue === "string") return raw;

  if (typeof defaultValue === "number") {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      throw new ConfigError(`Environment variable '${name}': cannot coerce '${raw}' to number`);
    }
    return n;
  }

  // boolean
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ConfigError(`Environment variable '${name}': cannot coerce '${raw}' to boolean (expected true/false/1/0)`);
}

// ── Full Resolution Pipeline (§7.1 steps 2-6) ──

export function resolveConfig(
  descriptor: WorkflowDescriptor,
  options?: ResolveConfigOptions,
): ResolvedConfig {
  // Validate base descriptor first (V10: base must not have server)
  const baseValidation = validateConfig(descriptor);
  if (!baseValidation.ok) {
    const messages = baseValidation.errors.map((e) => `[${e.rule}] ${e.path}: ${e.message}`);
    throw new ConfigError(`Config validation failed:\n${messages.join("\n")}`);
  }

  // Step 2: entrypoint overlay
  const merged = applyOverlay(descriptor, options?.entrypoint);

  // Step 3: validate merged descriptor (post-overlay may have server from entrypoint,
  // which is valid — V10 only applies to the authored base descriptor, already checked above)
  if (options?.entrypoint) {
    const mergedValidation = validateConfig(merged);
    if (!mergedValidation.ok) {
      // Filter out V10 errors since server was added by entrypoint (legitimate)
      const realErrors = mergedValidation.errors.filter((e) => e.rule !== "V10");
      if (realErrors.length > 0) {
        const messages = realErrors.map((e) => `[${e.rule}] ${e.path}: ${e.message}`);
        throw new ConfigError(`Config validation failed:\n${messages.join("\n")}`);
      }
    }
  }

  // Step 4: environment collection
  const envNodes = collectEnvNodes(merged);

  // Step 5-6: environment resolution
  const processEnv = options?.processEnv ?? process.env as Record<string, string | undefined>;
  const resolvedEnv = resolveEnv(envNodes, processEnv);

  // Replace env nodes with resolved values and project
  return projectConfig(merged, resolvedEnv);
}

// ── Projection (§7.5.2) ──

export function projectConfig(
  descriptor: WorkflowDescriptor,
  resolvedEnv: Map<EnvDescriptor, string | number | boolean>,
): ResolvedConfig {
  const agents = (descriptor.agents as AgentBinding[]).map((a) =>
    projectAgent(a, resolvedEnv),
  );

  const journal = projectJournal(descriptor.journal, resolvedEnv);

  const result: ResolvedConfig = { agents, journal };

  // Server comes from merged descriptor (may have been added by overlay)
  const serverField = (descriptor as unknown as Record<string, unknown>).server as ServerDescriptor | undefined;
  if (serverField) {
    result.server = projectServer(serverField, resolvedEnv);
  }

  return result;
}

function projectAgent(
  agent: AgentBinding,
  resolvedEnv: Map<EnvDescriptor, string | number | boolean>,
): ResolvedAgent {
  const transportObj = agent.transport as unknown as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(transportObj)) {
    if (key === "tisyn_config") continue;
    projected[key] = resolveValue(val, resolvedEnv);
  }
  return { id: agent.id, transport: projected };
}

function projectJournal(
  journal: JournalDescriptor | undefined,
  resolvedEnv: Map<EnvDescriptor, string | number | boolean>,
): ResolvedJournal {
  if (!journal) return { kind: "memory" };

  if (journal.kind === "memory") return { kind: "memory" };

  return {
    kind: "file",
    path: resolveValue(journal.path, resolvedEnv) as string,
  };
}

function projectServer(
  server: ServerDescriptor,
  resolvedEnv: Map<EnvDescriptor, string | number | boolean>,
): ResolvedServer {
  const result: ResolvedServer = {
    kind: server.kind,
    port: resolveValue(server.port, resolvedEnv) as number,
  };
  if (server.static != null) result.static = server.static;
  return result;
}

function resolveValue(
  value: unknown,
  resolvedEnv: Map<EnvDescriptor, string | number | boolean>,
): unknown {
  if (value === null || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  if (obj.tisyn_config === "env") {
    const resolved = resolvedEnv.get(value as EnvDescriptor);
    if (resolved !== undefined) return resolved;
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, resolvedEnv));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = resolveValue(val, resolvedEnv);
  }
  return result;
}
