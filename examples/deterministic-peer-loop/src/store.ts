import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  EMPTY_STORE,
  StoreDocumentSchema,
  type EffectRequestRecord,
  type LoopControl,
  type PeerRecord,
  type StoreDocument,
  type TurnEntry,
} from "./schemas.js";

export interface Store {
  loadMessages(): TurnEntry[];
  appendMessage(entry: TurnEntry): void;
  loadControl(): LoopControl;
  writeControl(control: LoopControl): void;
  loadPeerRecords(): PeerRecord[];
  appendPeerRecord(record: PeerRecord): void;
  loadEffectRequests(): EffectRequestRecord[];
  appendEffectRequest(record: EffectRequestRecord): void;
  snapshot(): StoreDocument;
  subscribe(listener: StoreListener): () => void;
}

export type StoreEvent =
  | { kind: "message"; entry: TurnEntry }
  | { kind: "control"; control: LoopControl }
  | { kind: "peerRecord"; record: PeerRecord }
  | { kind: "effectRequest"; record: EffectRequestRecord };

export type StoreListener = (event: StoreEvent) => void;

function readStore(path: string): StoreDocument {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return structuredClone(EMPTY_STORE);
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Value.Check(StoreDocumentSchema, parsed)) {
    const errors = [...Value.Errors(StoreDocumentSchema, parsed)];
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Invalid store document at ${path}: ${detail}`);
  }
  return parsed as StoreDocument;
}

function writeStore(path: string, doc: StoreDocument): void {
  if (!Value.Check(StoreDocumentSchema, doc)) {
    const errors = [...Value.Errors(StoreDocumentSchema, doc)];
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Refusing to persist invalid store document: ${detail}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

const storeCache = new Map<string, Store>();

export function getOrCreateStore(dbPath: string): Store {
  const existing = storeCache.get(dbPath);
  if (existing) {
    return existing;
  }
  const fresh = createStore(dbPath);
  storeCache.set(dbPath, fresh);
  return fresh;
}

export function resetStoreCache(): void {
  storeCache.clear();
}

export function createStore(dbPath: string): Store {
  let doc = readStore(dbPath);
  const listeners = new Set<StoreListener>();

  function emit(event: StoreEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  return {
    loadMessages() {
      return [...doc.messages];
    },
    appendMessage(entry) {
      doc = { ...doc, messages: [...doc.messages, entry] };
      writeStore(dbPath, doc);
      emit({ kind: "message", entry });
    },
    loadControl() {
      return { ...doc.control };
    },
    writeControl(control) {
      doc = { ...doc, control };
      writeStore(dbPath, doc);
      emit({ kind: "control", control });
    },
    loadPeerRecords() {
      return [...doc.peerRecords];
    },
    appendPeerRecord(record) {
      doc = { ...doc, peerRecords: [...doc.peerRecords, record] };
      writeStore(dbPath, doc);
      emit({ kind: "peerRecord", record });
    },
    loadEffectRequests() {
      return [...doc.effectRequests];
    },
    appendEffectRequest(record) {
      doc = { ...doc, effectRequests: [...doc.effectRequests, record] };
      writeStore(dbPath, doc);
      emit({ kind: "effectRequest", record });
    },
    snapshot() {
      return structuredClone(doc);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createMemoryStore(initial?: Partial<StoreDocument>): Store {
  let doc: StoreDocument = {
    ...structuredClone(EMPTY_STORE),
    ...initial,
  };
  const listeners = new Set<StoreListener>();
  function emit(event: StoreEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }
  return {
    loadMessages() {
      return [...doc.messages];
    },
    appendMessage(entry) {
      doc = { ...doc, messages: [...doc.messages, entry] };
      emit({ kind: "message", entry });
    },
    loadControl() {
      return { ...doc.control };
    },
    writeControl(control) {
      doc = { ...doc, control };
      emit({ kind: "control", control });
    },
    loadPeerRecords() {
      return [...doc.peerRecords];
    },
    appendPeerRecord(record) {
      doc = { ...doc, peerRecords: [...doc.peerRecords, record] };
      emit({ kind: "peerRecord", record });
    },
    loadEffectRequests() {
      return [...doc.effectRequests];
    },
    appendEffectRequest(record) {
      doc = { ...doc, effectRequests: [...doc.effectRequests, record] };
      emit({ kind: "effectRequest", record });
    },
    snapshot() {
      return structuredClone(doc);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
