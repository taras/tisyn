import type { Operation, Stream } from "effection";
import type {
  InitializeRequest,
  InitializeResponse,
  InitializeProtocolError,
  ExecuteRequest,
  ExecuteResponse,
  ExecuteProtocolError,
  ProgressNotification,
  CancelNotification,
  ShutdownNotification,
} from "@tisyn/protocol";

/**
 * Generic bidirectional transport: send outgoing messages, receive incoming
 * messages as a stream.
 */
export interface Transport<TSend, TReceive> {
  send(message: TSend): Operation<void>;
  receive: Stream<TReceive, void>;
}

/**
 * Messages the host sends to the agent.
 */
export type HostMessage =
  | InitializeRequest
  | ExecuteRequest
  | CancelNotification
  | ShutdownNotification;

/**
 * Messages the agent sends to the host.
 */
export type AgentMessage =
  | InitializeResponse
  | InitializeProtocolError
  | ExecuteResponse
  | ExecuteProtocolError
  | ProgressNotification;

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
