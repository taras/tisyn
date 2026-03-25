/**
 * File-backed DurableStream using NDJSON (one JSON event per line).
 *
 * Append-only, synchronous writes for durability. Single-process only.
 */

import type { Operation } from "effection";
import type { DurableStream } from "@tisyn/durable-streams";
import type { DurableEvent } from "@tisyn/kernel";
import { readFileSync, appendFileSync, existsSync } from "node:fs";

export class FileJournalStream implements DurableStream {
  constructor(private path: string) {}

  // biome-ignore lint/correctness/useYield: synchronous generator for Operation interface
  *readAll(): Operation<DurableEvent[]> {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line, i) => {
        try {
          return JSON.parse(line) as DurableEvent;
        } catch (e) {
          throw new Error(`Malformed NDJSON at ${this.path}:${i + 1}: ${(e as Error).message}`);
        }
      })
      .filter((event) => event.type !== "close");
  }

  // biome-ignore lint/correctness/useYield: synchronous generator for Operation interface
  *append(event: DurableEvent): Operation<void> {
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }
}
