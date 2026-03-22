import type { Operation, Stream } from "effection";
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
