import type { Operation, Stream } from "effection";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";
import type { HostMessage, AgentMessage } from "@tisyn/protocol";

/**
 * Generic bidirectional transport: send outgoing messages, receive incoming
 * messages as a stream.
 */
export interface Transport<TSend, TReceive, TClose = unknown> {
  send(message: TSend): Operation<void>;
  receive: Stream<TReceive, TClose>;
}

export type { HostMessage, AgentMessage };

/**
 * A transport typed for the Tisyn protocol message catalog.
 */
export type AgentTransport = Transport<HostMessage, AgentMessage>;

/**
 * Factory that creates a scoped AgentTransport resource.
 * Acquiring the resource establishes the connection.
 * Leaving scope closes it.
 */
export type AgentTransportFactory = () => Operation<AgentTransport>;

/**
 * Contract for local/inprocess transport modules loaded by the CLI.
 *
 * Modules export `createBinding()` returning this interface.
 * The `transport` field is the standard agent transport factory.
 * The optional `bindServer` hook receives the CLI's server binding
 * so the module can accept browser connections without raw `wss` access.
 *
 * `bindServer` is a setup-only hook: it MUST spawn any long-lived work
 * (e.g., connection acceptance loops) via `yield* spawn(...)` and return
 * promptly. Spawned work inherits the caller's Effection scope and tears
 * down on scope exit.
 */
export interface LocalAgentBinding {
  transport: AgentTransportFactory;
  bindServer?(server: LocalServerBinding): Operation<void>;
}

/**
 * Server binding provided by the CLI to local/inprocess modules
 * via `LocalAgentBinding.bindServer`.
 *
 * Provides the server address and an optional stream of accepted
 * WebSocket connections. Each connection is an Effection resource
 * that closes the underlying socket on scope exit.
 */
export interface LocalServerBinding {
  address: AddressInfo;
  connections?: Stream<Operation<WebSocket>, never>;
}
