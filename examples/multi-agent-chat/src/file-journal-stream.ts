/**
 * File-backed DurableStream using NDJSON (one JSON event per line).
 *
 * Append-only, async writes with fsync for durability. Single-process only.
 */

import { call } from "effection";
import type { Operation } from "effection";
import type { DurableStream } from "@tisyn/durable-streams";
import type { DurableEvent } from "@tisyn/kernel";
import { readFile, writeFile } from "node:fs/promises";

export class FileJournalStream implements DurableStream {
  constructor(private path: string) {}

  *readAll(): Operation<DurableEvent[]> {
    let content: string;
    try {
      content = yield* call(() => readFile(this.path, "utf-8"));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
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

  *append(event: DurableEvent): Operation<void> {
    yield* call(() =>
      writeFile(this.path, JSON.stringify(event) + "\n", { flag: "a", flush: true }),
    );
  }
}
