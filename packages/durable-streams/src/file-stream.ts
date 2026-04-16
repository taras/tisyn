/**
 * File-backed DurableStream implementation.
 *
 * Format: newline-delimited JSON (NDJSON). One DurableEvent per
 * line, encoded as `JSON.stringify(event) + "\n"`. No framing, no
 * sidecar metadata, no trailing comma. Readers split on "\n" and
 * filter empty strings so a trailing newline is tolerated.
 *
 * Semantics:
 * - `append(event)` ensures the parent directory exists on the
 *   first call (cached by a private flag), then appends one line
 *   via `fs.appendFile` wrapped in Effection's `call`. Durability
 *   matches `fs.appendFile`'s guarantees — same best-effort
 *   contract `InMemoryStream` already ships with.
 * - `readAll()` returns `[]` when the file is missing (ENOENT),
 *   treating a missing journal as a fresh run. A malformed line
 *   throws an Error that identifies the path and the 1-indexed
 *   line number so the operator can locate the corrupt row.
 *
 * The constructor takes an absolute path — the CLI's
 * `rebaseConfigPaths` already resolves relative journal paths
 * against the descriptor directory before `createJournalStream`
 * builds the stream, so double-rebasing inside `FileStream` is
 * unnecessary and would break absolute and env-overridden paths.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { call, type Operation } from "effection";
import type { DurableEvent } from "@tisyn/kernel";
import type { DurableStream } from "./stream.js";

export class FileStream implements DurableStream {
  readonly #path: string;
  #parentEnsured = false;

  constructor(path: string) {
    this.#path = path;
  }

  *append(event: DurableEvent): Operation<void> {
    if (!this.#parentEnsured) {
      const dir = dirname(this.#path);
      yield* call(() => mkdir(dir, { recursive: true }));
      this.#parentEnsured = true;
    }
    const line = `${JSON.stringify(event)}\n`;
    yield* call(() => appendFile(this.#path, line, "utf8"));
  }

  *readAll(): Operation<DurableEvent[]> {
    const path = this.#path;
    const content = yield* call(async () => {
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    });
    if (content === null) {
      return [];
    }
    const lines = content.split("\n");
    const events: DurableEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") {
        continue;
      }
      try {
        events.push(JSON.parse(line) as DurableEvent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`FileStream: malformed NDJSON at ${path}:${i + 1}: ${message}`);
      }
    }
    return events;
  }
}
