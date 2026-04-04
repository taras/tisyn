// ── Workflow Descriptor ──

export interface WorkflowRef {
  readonly export: string;
  readonly module?: string;
}

export interface WorkflowDescriptor {
  readonly tisyn_config: "workflow";
  readonly run: WorkflowRef;
  readonly agents: readonly AgentBinding[];
  readonly journal?: JournalDescriptor;
  readonly entrypoints?: Readonly<Record<string, EntrypointDescriptor>>;
}

// ── Agent Binding ──

export interface AgentBinding {
  readonly tisyn_config: "agent";
  readonly id: string;
  readonly transport: TransportDescriptor;
  readonly config?: Readonly<Record<string, unknown>>;
}

// ── Transport Descriptors ──

export interface TransportDescriptorBase {
  readonly tisyn_config: "transport";
  readonly kind: string;
}

export interface WorkerTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "worker";
  readonly url: string | EnvDescriptor;
}

export interface LocalTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "local";
  readonly module: string;
}

export interface StdioTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "stdio";
  readonly command: string | EnvDescriptor;
  readonly args?: readonly (string | EnvDescriptor)[];
}

export interface WebSocketTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "websocket";
  readonly url: string | EnvDescriptor;
}

export interface InprocessTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "inprocess";
  readonly module: string;
}

export type TransportDescriptor =
  | WorkerTransportDescriptor
  | LocalTransportDescriptor
  | StdioTransportDescriptor
  | WebSocketTransportDescriptor
  | InprocessTransportDescriptor;

// ── Environment Descriptors ──

export interface EnvOptionalDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "optional";
  readonly name: string;
  readonly default: string | number | boolean;
}

export interface EnvRequiredDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "required";
  readonly name: string;
}

export interface EnvSecretDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "secret";
  readonly name: string;
}

export type EnvDescriptor = EnvOptionalDescriptor | EnvRequiredDescriptor | EnvSecretDescriptor;

// ── Journal Descriptors ──

export interface FileJournalDescriptor {
  readonly tisyn_config: "journal";
  readonly kind: "file";
  readonly path: string | EnvDescriptor;
}

export interface MemoryJournalDescriptor {
  readonly tisyn_config: "journal";
  readonly kind: "memory";
}

export type JournalDescriptor = FileJournalDescriptor | MemoryJournalDescriptor;

// ── Entrypoint Descriptor ──

export interface EntrypointDescriptor {
  readonly tisyn_config: "entrypoint";
  readonly agents?: readonly AgentBinding[];
  readonly journal?: JournalDescriptor;
  readonly server?: ServerDescriptor;
}

// ── Server Descriptor ──

export interface ServerDescriptor {
  readonly tisyn_config: "server";
  readonly kind: string;
  readonly port: number | EnvDescriptor;
  readonly static?: string;
}

// ── Config Token ──

export interface ConfigToken<_T> {
  readonly __tisyn_config_token__: unique symbol;
}
