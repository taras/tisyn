/**
 * DB agent — in-process persistence backed by a single JSON store.
 *
 * Shared with the App binding via {@link getOrCreateStore}, keyed by dbPath.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { getOrCreateStore, type Store } from "./store.js";
import type { EffectRequestRecord, LoopControl, PeerRecord, TurnEntry } from "./schemas.js";

export const DB = () =>
  agent("d-b", {
    loadMessages: operation<Record<string, never>, TurnEntry[]>(),
    appendMessage: operation<{ entry: TurnEntry }, void>(),
    loadControl: operation<Record<string, never>, LoopControl>(),
    writeControl: operation<{ control: LoopControl }, void>(),
    loadPeerRecords: operation<Record<string, never>, PeerRecord[]>(),
    appendPeerRecord: operation<{ record: PeerRecord }, void>(),
    loadEffectRequests: operation<Record<string, never>, EffectRequestRecord[]>(),
    appendEffectRequest: operation<{ record: EffectRequestRecord }, void>(),
  });

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const dbPath = (config?.dbPath as string) ?? "./data/peer-loop.json";
  const store: Store = getOrCreateStore(dbPath);

  return {
    transport: inprocessTransport(DB(), {
      *loadMessages() {
        return store.loadMessages();
      },
      *appendMessage({ entry }) {
        store.appendMessage(entry);
      },
      *loadControl() {
        return store.loadControl();
      },
      *writeControl({ control }) {
        store.writeControl(control);
      },
      *loadPeerRecords() {
        return store.loadPeerRecords();
      },
      *appendPeerRecord({ record }) {
        store.appendPeerRecord(record);
      },
      *loadEffectRequests() {
        return store.loadEffectRequests();
      },
      *appendEffectRequest({ record }) {
        store.appendEffectRequest(record);
      },
    }),
  };
}
