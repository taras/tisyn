import type {
  WorkflowDescriptor,
  WorkflowRef,
  AgentBinding,
  TransportDescriptor,
  WorkerTransportDescriptor,
  LocalTransportDescriptor,
  StdioTransportDescriptor,
  WebSocketTransportDescriptor,
  InprocessTransportDescriptor,
  EnvOptionalDescriptor,
  EnvRequiredDescriptor,
  EnvSecretDescriptor,
  EnvDescriptor,
  FileJournalDescriptor,
  MemoryJournalDescriptor,
  JournalDescriptor,
  EntrypointDescriptor,
  ServerDescriptor,
} from "./types.js";

// ── workflow ──

export function workflow(config: {
  run: string | WorkflowRef;
  agents: AgentBinding[];
  journal?: JournalDescriptor;
  entrypoints?: Record<string, EntrypointDescriptor>;
}): WorkflowDescriptor {
  const run: WorkflowRef = typeof config.run === "string" ? { export: config.run } : config.run;
  return {
    tisyn_config: "workflow",
    run,
    agents: config.agents,
    ...(config.journal != null ? { journal: config.journal } : {}),
    ...(config.entrypoints != null ? { entrypoints: config.entrypoints } : {}),
  };
}

// ── agent ──

export function agent(id: string, transport: TransportDescriptor): AgentBinding {
  return { tisyn_config: "agent", id, transport };
}

// ── transport ──

export const transport = {
  worker(url: string | EnvDescriptor): WorkerTransportDescriptor {
    return { tisyn_config: "transport", kind: "worker", url };
  },
  local(module: string): LocalTransportDescriptor {
    return { tisyn_config: "transport", kind: "local", module };
  },
  stdio(
    command: string | EnvDescriptor,
    args?: (string | EnvDescriptor)[],
  ): StdioTransportDescriptor {
    return {
      tisyn_config: "transport",
      kind: "stdio",
      command,
      ...(args != null ? { args } : {}),
    };
  },
  websocket(url: string | EnvDescriptor): WebSocketTransportDescriptor {
    return { tisyn_config: "transport", kind: "websocket", url };
  },
  inprocess(module: string): InprocessTransportDescriptor {
    return { tisyn_config: "transport", kind: "inprocess", module };
  },
};

// ── env ──

function envOptional(name: string, defaultValue: string | number | boolean): EnvOptionalDescriptor {
  return { tisyn_config: "env", mode: "optional", name, default: defaultValue };
}

function envRequired(name: string): EnvRequiredDescriptor {
  return { tisyn_config: "env", mode: "required", name };
}

function envSecret(name: string): EnvSecretDescriptor {
  return { tisyn_config: "env", mode: "secret", name };
}

export const env: {
  (name: string, defaultValue: string | number | boolean): EnvOptionalDescriptor;
  required(name: string): EnvRequiredDescriptor;
  secret(name: string): EnvSecretDescriptor;
} = Object.assign(envOptional, { required: envRequired, secret: envSecret });

// ── journal ──

export const journal = {
  file(path: string | EnvDescriptor): FileJournalDescriptor {
    return { tisyn_config: "journal", kind: "file", path };
  },
  memory(): MemoryJournalDescriptor {
    return { tisyn_config: "journal", kind: "memory" };
  },
};

// ── entrypoint ──

export function entrypoint(config?: {
  agents?: AgentBinding[];
  journal?: JournalDescriptor;
  server?: ServerDescriptor;
}): EntrypointDescriptor {
  return {
    tisyn_config: "entrypoint",
    ...(config?.agents != null ? { agents: config.agents } : {}),
    ...(config?.journal != null ? { journal: config.journal } : {}),
    ...(config?.server != null ? { server: config.server } : {}),
  };
}

// ── server ──

export const server = {
  websocket(config: { port: number | EnvDescriptor; static?: string }): ServerDescriptor {
    return {
      tisyn_config: "server",
      kind: "websocket",
      port: config.port,
      ...(config.static != null ? { static: config.static } : {}),
    };
  },
};
