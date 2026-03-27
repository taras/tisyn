import { withResolvers } from "effection";
import type { Operation } from "effection";
import type { WebSocket } from "ws";
import { logInfo, logDebug } from "./logger.js";

// --- Protocol types ---

export type BrowserToHost =
  | { type: "connect"; clientSessionId: string }
  | { type: "userMessage"; message: string };

export type HostToBrowser =
  | { type: "renderTranscript"; messages: Array<{ role: "user" | "assistant"; content: string }> }
  | { type: "elicit"; prompt: string }
  | { type: "setReadOnly"; reason: string };

// --- Session Manager ---

export class BrowserSessionManager {
  private ownerSessionId: string | null = null;
  private socket: WebSocket | null = null;
  private pendingElicitation: { resolve(msg: string): void; prompt: string } | null = null;
  private readOnly: { reason: string } | null = null;
  private transcript: Array<{ role: "user" | "assistant"; content: string }>;
  private ownerReady = withResolvers<void>();

  constructor(initialTranscript: Array<{ role: "user" | "assistant"; content: string }> = []) {
    this.transcript = [...initialTranscript];
  }

  /** Yields until the first browser sends a connect message. */
  waitForOwner(): Operation<void> {
    return this.ownerReady.operation;
  }

  /**
   * Attach a WebSocket to a session.
   * - First connect sets the owner session ID and resolves waitForOwner.
   * - Owner reconnect replaces the old socket (identity-safe).
   * - Non-owner gets read-only hydration only.
   */
  attach(clientSessionId: string, ws: WebSocket): void {
    // First connection — establish ownership
    if (this.ownerSessionId === null) {
      this.ownerSessionId = clientSessionId;
      this.ownerReady.resolve();
      logInfo("session", "owner established", { clientSessionId });
    }

    // Non-owner — send read-only view and return
    if (clientSessionId !== this.ownerSessionId) {
      logInfo("session", "non-owner connection", { clientSessionId });
      this.safeSend(ws, { type: "renderTranscript", messages: [...this.transcript] });
      this.safeSend(ws, { type: "setReadOnly", reason: "Session owned by another browser" });
      return;
    }

    // Owner reconnect — replace old socket (identity-safe)
    const oldSocket = this.socket;
    this.socket = ws;

    // Set up listeners that capture `ws` for identity-safe detach
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as BrowserToHost;
        this.handleMessage(msg);
      } catch {
        logDebug("session", "failed to parse browser message");
      }
    });

    ws.on("close", () => {
      this.detach(ws);
    });

    // Close old socket after new one is stored (identity-safe: old close listener is a no-op)
    if (oldSocket) {
      logInfo("session", "replacing old socket");
      oldSocket.close();
    }

    // Send current state to the new socket
    logInfo("session", "owner attached", { transcriptLength: this.transcript.length });
    this.safeSend(ws, { type: "renderTranscript", messages: [...this.transcript] });

    if (this.pendingElicitation) {
      logInfo("session", "re-sending pending prompt", { prompt: this.pendingElicitation.prompt });
      this.safeSend(ws, { type: "elicit", prompt: this.pendingElicitation.prompt });
    }

    if (this.readOnly) {
      this.safeSend(ws, { type: "setReadOnly", reason: this.readOnly.reason });
    }
  }

  /**
   * Identity-safe detach: only clears this.socket if it matches the given ws.
   * A stale close listener from an old socket will not clear a newer socket.
   */
  detach(ws: WebSocket): void {
    if (this.socket === ws) {
      logInfo("session", "owner detached");
      this.socket = null;
    }
  }

  /**
   * Reconnect-safe elicitation. Suspends via withResolvers until the owner
   * browser sends a userMessage. Survives disconnect — the resolvers stay
   * pending until a reconnected browser submits.
   */
  elicit(prompt: string): Operation<{ message: string }> {
    const { operation, resolve } = withResolvers<string>();

    this.pendingElicitation = { resolve, prompt };

    if (this.socket) {
      this.safeSend(this.socket, { type: "elicit", prompt });
    }

    return {
      *[Symbol.iterator]() {
        const message = yield* operation;
        return { message };
      },
    };
  }

  /**
   * Update transcript projection and publish it if connected.
   */
  renderTranscript(messages: Array<{ role: "user" | "assistant"; content: string }>): void {
    this.transcript = [...messages];
    if (this.socket) {
      this.safeSend(this.socket, { type: "renderTranscript", messages: [...this.transcript] });
    }
  }

  /** Mark the session as read-only (workflow ended). */
  setReadOnly(reason: string): void {
    this.readOnly = { reason };
    if (this.socket) {
      this.safeSend(this.socket, { type: "setReadOnly", reason });
    }
  }

  private handleMessage(msg: BrowserToHost): void {
    if (msg.type === "userMessage" && this.pendingElicitation) {
      logInfo("session", "userMessage received", { message: msg.message });
      const { resolve } = this.pendingElicitation;
      this.pendingElicitation = null;
      resolve(msg.message);
    }
  }

  private safeSend(ws: WebSocket, msg: HostToBrowser): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      logDebug("session", "safeSend failed (socket closing)");
    }
  }
}
