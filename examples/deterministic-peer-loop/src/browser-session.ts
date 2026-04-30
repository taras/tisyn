import type { WebSocket } from "ws";
import { Value } from "@sinclair/typebox/value";
import {
  BrowserToHostSchema,
  BrowserControlPatchSchema,
  type BrowserControlPatch,
  type BrowserToHost,
  type HostToBrowser,
  type LoopControl,
  type TurnEntry,
} from "./schemas.js";
import { logInfo, logDebug } from "./logger.js";

export type { BrowserToHost, HostToBrowser } from "./schemas.js";

export interface BrowserSessionHooks {
  /** Called when the owner submits a user message in response to an elicit prompt. */
  onUserMessage(message: string): void;
  /**
   * Called when the owner submits a control-panel patch. The manager has already
   * validated the patch shape via TypeBox; the hook owns the persistence decision.
   */
  onUpdateControl(patch: BrowserControlPatch): void;
}

/**
 * Plain session state container for browser WebSocket connections.
 *
 * Owns only synchronous, plain data. The workflow-observable pieces of
 * state (transcript + LoopControl) are mirrored here so reconnecting
 * owners and observers are hydrated without re-dispatching through the
 * workflow.
 */
export class BrowserSessionManager {
  private ownerSessionId: string | null = null;
  private ownerSocket: WebSocket | null = null;
  private observers: Set<WebSocket> = new Set();
  private pendingPrompt: string | null = null;
  private chatMessages: TurnEntry[] = [];
  private control: LoopControl = { paused: false, stopRequested: false };
  private readOnly: { reason: string } | null = null;

  constructor(private hooks: BrowserSessionHooks) {}

  attach(clientSessionId: string, ws: WebSocket): void {
    if (this.ownerSessionId === null) {
      this.ownerSessionId = clientSessionId;
      logInfo("session", "owner established", { clientSessionId });
    }

    if (clientSessionId !== this.ownerSessionId) {
      logInfo("session", "observer attached", { clientSessionId });
      this.observers.add(ws);
      ws.on("close", () => {
        this.observers.delete(ws);
      });
      this.hydrateObserver(ws);
      return;
    }

    const oldSocket = this.ownerSocket;
    this.ownerSocket = ws;

    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        logDebug("session", "failed to parse browser message");
        return;
      }
      if (!Value.Check(BrowserToHostSchema, parsed)) {
        logDebug("session", "rejected invalid BrowserToHost message");
        return;
      }
      this.handleMessage(ws, parsed as BrowserToHost);
    });

    ws.on("close", () => {
      this.detach(ws);
    });

    if (oldSocket) {
      logInfo("session", "replacing old owner socket");
      oldSocket.close();
    }

    this.hydrateOwner(ws);
  }

  detach(ws: WebSocket): void {
    if (this.ownerSocket === ws) {
      logInfo("session", "owner detached");
      this.ownerSocket = null;
      return;
    }
    this.observers.delete(ws);
  }

  /** Called by the App binding after the workflow calls loadChat(messages). */
  loadChat(messages: TurnEntry[]): void {
    this.chatMessages = [...messages];
    const payload: HostToBrowser = {
      type: "loadChat",
      messages: [...this.chatMessages],
    };
    this.sendToOwner(payload);
    this.sendToObservers(payload);
  }

  /** Push an elicit prompt and remember it for reconnect hydration. */
  beginElicit(message: string): void {
    this.pendingPrompt = message;
    this.sendToOwner({ type: "elicit", message });
  }

  endElicit(): void {
    this.pendingPrompt = null;
  }

  /** Append a displayed message and broadcast to the attached owner socket. */
  showMessage(entry: TurnEntry): void {
    this.chatMessages.push(entry);
    const payload: HostToBrowser = {
      type: "showMessage",
      speaker: entry.speaker,
      content: entry.content,
    };
    this.sendToOwner(payload);
    this.sendToObservers(payload);
  }

  setReadOnly(reason: string): void {
    this.readOnly = { reason };
    const payload: HostToBrowser = { type: "setReadOnly", reason };
    this.sendToOwner(payload);
    this.sendToObservers(payload);
  }

  /** Called externally when the durable LoopControl changes (from store subscription). */
  publishControl(control: LoopControl): void {
    this.control = { ...control };
    const payload: HostToBrowser = {
      type: "controlSnapshot",
      control: this.control,
    };
    this.sendToOwner(payload);
    this.sendToObservers(payload);
  }

  getControlSnapshot(): LoopControl {
    return { ...this.control };
  }

  /** Record the owner-submitted user message to the transcript mirror. */
  recordUserMessage(entry: TurnEntry): void {
    this.chatMessages.push(entry);
  }

  private hydrateOwner(ws: WebSocket): void {
    logInfo("session", "owner attached", { chatLength: this.chatMessages.length });
    this.safeSend(ws, { type: "loadChat", messages: [...this.chatMessages] });
    this.safeSend(ws, { type: "controlSnapshot", control: { ...this.control } });

    if (this.pendingPrompt) {
      logInfo("session", "re-sending pending elicit", { message: this.pendingPrompt });
      this.safeSend(ws, { type: "elicit", message: this.pendingPrompt });
    }

    if (this.readOnly) {
      this.safeSend(ws, { type: "setReadOnly", reason: this.readOnly.reason });
    }
  }

  private hydrateObserver(ws: WebSocket): void {
    this.safeSend(ws, { type: "loadChat", messages: [...this.chatMessages] });
    this.safeSend(ws, { type: "controlSnapshot", control: { ...this.control } });
    const reason = this.readOnly ? this.readOnly.reason : "Session owned by another browser";
    this.safeSend(ws, { type: "setReadOnly", reason });
  }

  private sendToOwner(payload: HostToBrowser): void {
    if (this.ownerSocket) {
      this.safeSend(this.ownerSocket, payload);
    }
  }

  private sendToObservers(payload: HostToBrowser): void {
    for (const ws of this.observers) {
      this.safeSend(ws, payload);
    }
  }

  private handleMessage(ws: WebSocket, msg: BrowserToHost): void {
    if (this.ownerSocket !== ws) {
      return;
    }
    if (msg.type === "userMessage" && this.pendingPrompt) {
      logInfo("session", "userMessage received", { message: msg.message });
      this.pendingPrompt = null;
      this.hooks.onUserMessage(msg.message);
      return;
    }
    if (msg.type === "updateControl") {
      if (!Value.Check(BrowserControlPatchSchema, msg.patch)) {
        logDebug("session", "rejected invalid updateControl patch");
        return;
      }
      this.hooks.onUpdateControl(msg.patch);
      return;
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
