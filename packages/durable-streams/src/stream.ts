/**
 * DurableStream interface and in-memory implementation.
 *
 * Mirrors the @effectionx/durable-streams API.
 * The interface is abstract — any append-only store can be adapted.
 *
 * Guarantees:
 * - Append-only (events never updated or deleted)
 * - Prefix-closed (no gaps)
 * - Monotonic indexing (sequential offsets)
 * - Durability (once append resolves, the event persists)
 */

import type { Operation } from "effection";
import type { DurableEvent } from "@tisyn/shared";

function cloneEvent(event: DurableEvent): DurableEvent {
  return structuredClone(event);
}

function cloneEvents(events: DurableEvent[]): DurableEvent[] {
  return events.map(cloneEvent);
}

/** Abstract interface for the append-only durable event stream. */
export interface DurableStream {
  /** Read all events in the stream, in append order. */
  readAll(): Operation<DurableEvent[]>;

  /** Append an event. Completes only after durably persisted. */
  append(event: DurableEvent): Operation<void>;
}

/**
 * In-memory DurableStream implementation for testing.
 *
 * Clone-on-write for safety. Provides hooks for:
 * - Tracking append calls (verify no re-execution during replay)
 * - Injecting failures (for persist-before-resume testing)
 */
export class InMemoryStream implements DurableStream {
  private events: DurableEvent[] = [];

  /** Count of append calls — useful for verifying replay doesn't re-execute. */
  appendCount = 0;

  /** If set, append() will throw this error. */
  injectFailure: Error | null = null;

  constructor(initialEvents: DurableEvent[] = []) {
    this.events = cloneEvents(initialEvents);
  }

  // biome-ignore lint/correctness/useYield: synchronous generator for Operation interface
  *readAll(): Operation<DurableEvent[]> {
    return cloneEvents(this.events);
  }

  // biome-ignore lint/correctness/useYield: synchronous generator for Operation interface
  *append(event: DurableEvent): Operation<void> {
    if (this.injectFailure) {
      throw this.injectFailure;
    }
    const cloned = cloneEvent(event);
    this.events.push(cloned);
    this.appendCount++;
  }

  /** Get a snapshot of current events (for test assertions). */
  snapshot(): DurableEvent[] {
    return cloneEvents(this.events);
  }

  /** Reset the stream. */
  reset(events: DurableEvent[] = []): void {
    this.events = cloneEvents(events);
    this.appendCount = 0;
    this.injectFailure = null;
  }
}
