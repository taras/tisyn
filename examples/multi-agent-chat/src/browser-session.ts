import type { WebSocket } from "ws";
import { logInfo, logDebug } from "./logger.js";

// --- Protocol types ---

export type BrowserToHost =
  | { type: "connect"; clientSessionId: string }
  | { type: "userMessage"; message: string };

export type HostToBrowser =
  | { type: "loadChat"; messages: Array<{ role: string; content: string }> }
  | { type: "elicit"; message: string }
  | { type: "assistantMessage"; message: string }
  | { type: "setReadOnly"; reason: string };

// --- Session Manager ---

/**
 * Plain session state container for browser WebSocket connections.
 *
 * Owns only synchronous, plain data:
 * - session identity and ownership
 * - current WebSocket
 * - chat transcript
 * - pending prompt text (for reconnect hydration)
 *
 * Does NOT own operation resolvers or continuation state. Pending
 * operation waiting lives in the Effection scope via a binding-scoped
 * signal passed at construction.
 */
export class BrowserSessionManager {
  private ownerSessionId: string | null = null;
  private socket: WebSocket | null = null;
  private pendingPrompt: string | null = null;
  private chatMessages: Array<{ role: string; content: string }> = [];
  private readOnly: { reason: string } | null = null;

  /**
   * @param userInput — push-side of a binding-scoped signal. The manager
   * calls `send(msg)` when the owner browser submits a user message.
   * The Effection scope owns the signal's lifecycle; the manager just
   * pushes into it.
   */
  constructor(private userInput: { send(msg: string): void }) {}

  /**
   * Attach a WebSocket to a session.
   * - First connect sets the owner session ID.
   * - Owner reconnect replaces the old socket (identity-safe).
   * - Non-owner gets read-only hydration only.
   */
  attach(clientSessionId: string, ws: WebSocket): void {
    // First connection — establish ownership
    if (this.ownerSessionId === null) {
      this.ownerSessionId = clientSessionId;
      logInfo("session", "owner established", { clientSessionId });
    }

    // Non-owner — send read-only view and return
    if (clientSessionId !== this.ownerSessionId) {
      logInfo("session", "non-owner connection", { clientSessionId });
      this.safeSend(ws, { type: "loadChat", messages: [...this.chatMessages] });
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
    logInfo("session", "owner attached", { chatLength: this.chatMessages.length });
    this.safeSend(ws, { type: "loadChat", messages: [...this.chatMessages] });

    if (this.pendingPrompt) {
      logInfo("session", "re-sending pending elicit", { message: this.pendingPrompt });
      this.safeSend(ws, { type: "elicit", message: this.pendingPrompt });
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
   * Populate browser with chat history. Called by the workflow on startup.
   */
  loadChat(messages: Array<{ role: string; content: string }>): void {
    this.chatMessages = [...messages];
    if (this.socket) {
      this.safeSend(this.socket, { type: "loadChat", messages: [...this.chatMessages] });
    }
  }

  /**
   * Set the current elicit prompt as plain data and send to the browser.
   * The prompt is remembered for reconnect hydration.
   *
   * The caller (the binding's elicit handler) must subscribe to the
   * userInput signal BEFORE calling this — signal does not buffer.
   */
  beginElicit(message: string): void {
    this.pendingPrompt = message;
    if (this.socket) {
      this.safeSend(this.socket, { type: "elicit", message });
    }
  }

  /**
   * Clear the pending prompt. Called in the binding's finally block
   * so the prompt is cleaned up on both normal completion and cancellation.
   */
  endElicit(): void {
    this.pendingPrompt = null;
  }

  /**
   * Send assistant message to the browser if connected, and append to
   * chatMessages so reconnecting/non-owner clients see it.
   */
  showAssistantMessage(message: string): void {
    this.chatMessages.push({ role: "assistant", content: message });
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
      this.chatMessages.push({ role: "user", content: msg.message });
      this.pendingPrompt = null;
      this.userInput.send(msg.message);
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
