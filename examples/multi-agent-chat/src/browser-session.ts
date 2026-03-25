import { withResolvers } from "effection";
import type { Operation } from "effection";
import type { WebSocket } from "ws";
import { logInfo, logDebug } from "./logger.js";

// --- Protocol types ---

export type BrowserToHost =
  | { type: "connect"; clientSessionId: string }
  | { type: "userMessage"; message: string };

export type HostToBrowser =
  | { type: "hydrateTranscript"; messages: Array<{ role: string; content: string }> }
  | { type: "waitForUser"; prompt: string }
  | { type: "assistantMessage"; message: string }
  | { type: "setReadOnly"; reason: string };

// --- Session Manager ---

export class BrowserSessionManager {
  private ownerSessionId: string | null = null;
  private socket: WebSocket | null = null;
  private pendingPrompt: { resolve(msg: string): void; prompt: string } | null = null;
  private readOnly: { reason: string } | null = null;
  private ownerReady = withResolvers<void>();

  constructor(private history: Array<{ role: string; content: string }>) {}

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
      this.safeSend(ws, { type: "hydrateTranscript", messages: [...this.history] });
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
    logInfo("session", "owner attached", { historyLength: this.history.length });
    this.safeSend(ws, { type: "hydrateTranscript", messages: [...this.history] });

    if (this.pendingPrompt) {
      logInfo("session", "re-sending pending prompt", { prompt: this.pendingPrompt.prompt });
      this.safeSend(ws, { type: "waitForUser", prompt: this.pendingPrompt.prompt });
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
   * Reconnect-safe waitForUser. Suspends via withResolvers until the owner
   * browser sends a userMessage. Survives disconnect — the resolvers stay
   * pending until a reconnected browser submits.
   */
  waitForUser(prompt: string): Operation<{ message: string }> {
    const { operation, resolve } = withResolvers<string>();

    this.pendingPrompt = { resolve, prompt };

    if (this.socket) {
      this.safeSend(this.socket, { type: "waitForUser", prompt });
    }

    return {
      *[Symbol.iterator]() {
        const message = yield* operation;
        return { message };
      },
    };
  }

  /**
   * Send assistant message to the browser if connected.
   * No-op if disconnected — history is the source of truth.
   */
  showAssistantMessage(message: string): void {
    if (this.socket) {
      this.safeSend(this.socket, { type: "assistantMessage", message });
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
    if (msg.type === "userMessage" && this.pendingPrompt) {
      logInfo("session", "userMessage received", { message: msg.message });
      const { resolve } = this.pendingPrompt;
      this.pendingPrompt = null;
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
