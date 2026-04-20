/**
 * ACP-to-Tisyn protocol adapter.
 *
 * Translates between Tisyn protocol messages (HostMessage/AgentMessage)
 * and ACP JSON-RPC messages sent to/from the Claude Code stdio process.
 *
 * The adapter connects to a pre-existing ACP process via stdio NDJSON
 * or spawns one as a subprocess. It does NOT terminate the process on
 * scope exit — only the logical connection is closed.
 */

import type { Operation, Stream } from "effection";
import { resource, spawn } from "effection";
import { exec } from "@effectionx/process";
import { lines, filter, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import type { HostMessage, AgentMessage } from "@tisyn/transport";
import { executeSuccess, executeApplicationError, progressNotification } from "@tisyn/protocol";
import type {
  AcpRequest,
  AcpMessage,
  AcpSuccessResponse,
  AcpErrorResponse,
  AcpNotification,
} from "./types.js";

export interface AcpAdapterConfig {
  /** Command to spawn the ACP process. If omitted, connects to existing process via stdio. */
  command?: string;
  /** Arguments for the command. */
  arguments?: string[];
  /** Environment variables for the subprocess. */
  env?: Record<string, string>;
  /** Working directory for the subprocess. */
  cwd?: string;
}

export interface AcpAdapter {
  /**
   * Send a Tisyn protocol message to the ACP process (translated to ACP format).
   */
  sendTisynMessage(message: HostMessage): Operation<void>;
  /**
   * Stream of Tisyn protocol messages received from the ACP process
   * (translated from ACP format).
   */
  tisynMessages: Stream<AgentMessage, void>;
  /**
   * Block until the subprocess exits, then return a diagnostic Error
   * containing exit code/signal, command, and captured stderr.
   */
  waitForProcessExit(): Operation<Error>;
}

// ── Tisyn operation → ACP wire method mapping ──

/**
 * Explicit mapping from Tisyn authored operation names to ACP wire method names.
 *
 * Tisyn workflows use ergonomic TypeScript names (e.g. `ClaudeCode().newSession()`).
 * ACP wire protocol uses slash-separated method names (e.g. `session/new`).
 * The adapter translates between these — no passthrough.
 */
const OPERATION_TO_ACP_METHOD: Record<string, string> = {
  newSession: "session/new",
  closeSession: "session/close",
  plan: "session/prompt",
  prompt: "session/prompt",
  fork: "session/fork",
  openFork: "session/fork",
  cancel: "session/cancel",
};

function resolveAcpMethod(operation: string): string {
  const method = OPERATION_TO_ACP_METHOD[operation];
  if (!method) {
    throw new Error(
      `Unknown Tisyn operation "${operation}" — no ACP method mapping exists. ` +
        `Known operations: ${Object.keys(OPERATION_TO_ACP_METHOD).join(", ")}`,
    );
  }
  return method;
}

// ── ACP ↔ Tisyn translation (pure functions) ──

/**
 * Translate a Tisyn ExecuteRequest into an ACP request.
 * Maps the Tisyn operation name to the corresponding ACP wire method
 * and forwards the effect payload directly as ACP params.
 *
 * The operation may be fully qualified (e.g. "claude-code.newSession")
 * or bare (e.g. "newSession"). The agent prefix is stripped before lookup.
 */
export function tisynExecuteToAcp(id: string, operation: string, args: unknown): AcpRequest {
  const bare = operation.includes(".") ? operation.split(".").pop()! : operation;
  const params: Record<string, unknown> = (args as Record<string, unknown>) ?? {};
  return {
    jsonrpc: "2.0",
    id,
    method: resolveAcpMethod(bare),
    params,
  };
}

/**
 * Translate an ACP success response into a Tisyn ExecuteResponse.
 */
export function acpSuccessToTisyn(id: string, result: unknown): AgentMessage {
  return executeSuccess(id, result as import("@tisyn/ir").Val);
}

/**
 * Translate an ACP error response into a Tisyn ExecuteResponse.
 */
export function acpErrorToTisyn(
  id: string,
  error: { code: number; message: string; data?: unknown },
): AgentMessage {
  return executeApplicationError(id, {
    message: error.message,
    name: `AcpError(${error.code})`,
  });
}

/**
 * Translate an ACP notification into a Tisyn ProgressNotification.
 */
export function acpNotificationToTisyn(
  token: string,
  params: Record<string, unknown>,
): AgentMessage {
  return progressNotification(token, params as import("@tisyn/ir").Val);
}

/**
 * Parse a raw JSON value from the ACP process into a validated AcpMessage.
 * Validates structure and returns a discriminated union member.
 */
export function parseAcpMessage(json: unknown): AcpMessage {
  if (typeof json !== "object" || json === null) {
    throw new Error("Invalid ACP message: expected an object");
  }

  const msg = json as Record<string, unknown>;

  if (msg.jsonrpc !== "2.0") {
    throw new Error("Invalid ACP message: missing jsonrpc 2.0 field");
  }

  // Response: has "id" field
  if ("id" in msg && msg.id != null) {
    const id = String(msg.id);

    // Error response: has "error" object with code + message
    if ("error" in msg && typeof msg.error === "object" && msg.error !== null) {
      const err = msg.error as Record<string, unknown>;
      if (typeof err.code !== "number" || typeof err.message !== "string") {
        throw new Error(
          "Invalid ACP error response: error must have numeric code and string message",
        );
      }
      const parsed: AcpErrorResponse = {
        jsonrpc: "2.0",
        id,
        error: {
          code: err.code,
          message: err.message,
          ...(err.data !== undefined ? { data: err.data } : {}),
        },
      };
      return parsed;
    }

    // Success response: has "result" field
    if ("result" in msg) {
      const parsed: AcpSuccessResponse = {
        jsonrpc: "2.0",
        id,
        result: msg.result,
      };
      return parsed;
    }

    throw new Error("Invalid ACP response: must have either 'result' or 'error' field");
  }

  // Notification: has "method" field but no "id"
  if ("method" in msg && typeof msg.method === "string") {
    const params =
      typeof msg.params === "object" && msg.params !== null
        ? (msg.params as Record<string, unknown>)
        : {};
    const parsed: AcpNotification = {
      jsonrpc: "2.0",
      method: msg.method,
      params,
    };
    return parsed;
  }

  throw new Error(
    "Invalid ACP message: must be a response (with id) or notification (with method)",
  );
}

// ── Adapter resource ──

/**
 * Create an ACP adapter resource that connects to an ACP stdio process.
 *
 * The adapter translates Tisyn protocol messages to/from ACP format
 * and exposes them as `sendTisynMessage` / `tisynMessages`.
 */
export function createAcpAdapter(config?: AcpAdapterConfig): Operation<AcpAdapter> {
  return resource(function* (provide) {
    const command = config?.command ?? "claude";
    const args = config?.arguments ?? ["--acp"];

    const proc = yield* exec(command, {
      arguments: args,
      env: config?.env,
      cwd: config?.cwd,
    });

    // Capture stderr for diagnostic context when the process exits unexpectedly
    const stderrChunks: string[] = [];
    const decoder = new TextDecoder();
    yield* spawn(function* () {
      const sub = yield* proc.stderr;
      for (;;) {
        const { value, done } = yield* sub.next();
        if (done) {
          break;
        }
        stderrChunks.push(decoder.decode(value));
      }
    });

    // Track pending request IDs to their progress tokens
    const pendingTokens = new Map<string, string>();

    // Parse ACP responses from stdout and translate to Tisyn AgentMessages
    const tisynMessages: Stream<AgentMessage, void> = pipe(
      proc.stdout,
      lines(),
      filter(function* (line: string) {
        return line.trim().length > 0;
      }),
      map(function* (line: string): Operation<AgentMessage> {
        let json: unknown;
        try {
          json = JSON.parse(line);
        } catch {
          throw new Error(`Malformed JSON from ACP process: ${line}`);
        }

        const msg = parseAcpMessage(json);

        // Response (has id)
        if ("id" in msg && msg.id != null) {
          const id = String(msg.id);
          if ("error" in msg) {
            pendingTokens.delete(id);
            return acpErrorToTisyn(id, msg.error);
          }
          pendingTokens.delete(id);
          return acpSuccessToTisyn(id, msg.result);
        }

        // Notification (no id, has method)
        if ("method" in msg) {
          // Map ACP notifications to progress using the most recent pending token
          // ACP progress notifications include a request_id or we use the notification params
          const token = (msg.params?.request_id as string) ?? (msg.params?.token as string) ?? "";
          const progressToken = pendingTokens.get(token) ?? token;
          return acpNotificationToTisyn(progressToken, msg.params);
        }

        throw new Error(`Unrecognized ACP message: ${JSON.stringify(json)}`);
      }),
    ) as Stream<AgentMessage, void>;

    const adapter: AcpAdapter = {
      *sendTisynMessage(message: HostMessage) {
        // Initialize and shutdown are handled by the binding layer
        // (index.ts), not forwarded to the ACP process.
        if (message.method === "initialize" || message.method === "shutdown") {
          return;
        }

        if (message.method === "execute") {
          const { id, params } = message;
          const requestId = String(id);
          const token = params.progressToken ?? requestId;
          pendingTokens.set(requestId, String(token));

          const acpRequest = tisynExecuteToAcp(requestId, params.operation, params.args[0]);
          proc.stdin.send(JSON.stringify(acpRequest) + "\n");
          return;
        }

        if (message.method === "cancel") {
          const abortMsg: AcpRequest = {
            jsonrpc: "2.0",
            id: `cancel-${message.params.id}`,
            method: resolveAcpMethod("cancel"),
            params: { id: message.params.id, reason: message.params.reason },
          };
          proc.stdin.send(JSON.stringify(abortMsg) + "\n");
          return;
        }
      },
      tisynMessages,
      *waitForProcessExit() {
        const status = yield* proc.join();
        const stderr = stderrChunks.join("").trim();
        const exitInfo = status.signal
          ? `killed by signal ${status.signal}`
          : `exited with code ${status.code ?? "unknown"}`;
        return new Error(
          `Claude ACP subprocess ${exitInfo}` +
            ` (command: ${command} ${args.join(" ")})` +
            (stderr ? `\nstderr:\n${stderr}` : ""),
        );
      },
    };

    yield* provide(adapter);
  });
}
