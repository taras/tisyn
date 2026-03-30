/**
 * ReplayIndex — derived, in-memory structure built from the stream on startup.
 *
 * Provides per-coroutine cursored access to Yield events and keyed
 * access to Close events.
 *
 * See Conformance Suite §10.1 for the replay algorithm.
 */

import type {
  DurableEvent,
  CloseEvent,
  EffectDescription,
  EventResult,
} from "@tisyn/kernel";

export interface YieldEntry {
  description: EffectDescription;
  result: EventResult;
}

export class ReplayIndex {
  private yields = new Map<string, YieldEntry[]>();
  private cursors = new Map<string, number>();
  private closes = new Map<string, CloseEvent>();

  constructor(events: DurableEvent[]) {
    for (const event of events) {
      if (event.type === "yield") {
        let list = this.yields.get(event.coroutineId);
        if (!list) {
          list = [];
          this.yields.set(event.coroutineId, list);
        }
        list.push({
          description: event.description,
          result: event.result,
        });
      }
      if (event.type === "close") {
        this.closes.set(event.coroutineId, event);
      }
    }
  }

  /**
   * Returns the next unconsumed yield for this coroutine,
   * or undefined if the cursor is past the end.
   */
  peekYield(coroutineId: string): YieldEntry | undefined {
    const list = this.yields.get(coroutineId);
    const cursor = this.cursors.get(coroutineId) ?? 0;
    return list?.[cursor];
  }

  /** Advances the cursor for this coroutine by one position. */
  consumeYield(coroutineId: string): void {
    const cursor = this.cursors.get(coroutineId) ?? 0;
    this.cursors.set(coroutineId, cursor + 1);
  }

  /** Returns the current cursor position for this coroutine. */
  getCursor(coroutineId: string): number {
    return this.cursors.get(coroutineId) ?? 0;
  }

  /** Returns true if a Close event exists for this coroutine. */
  hasClose(coroutineId: string): boolean {
    return this.closes.has(coroutineId);
  }

  /** Returns the Close event for this coroutine, or undefined. */
  getClose(coroutineId: string): CloseEvent | undefined {
    return this.closes.get(coroutineId);
  }

}
