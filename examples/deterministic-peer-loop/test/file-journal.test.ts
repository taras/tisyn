import { describe as effDescribe, it as effIt } from "@effectionx/vitest";
import { expect } from "vitest";
import { call } from "effection";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { DurableEvent, YieldEvent } from "@tisyn/kernel";
import { FileJournalStream } from "../src/file-journal-stream.js";

function tmpJournalPath(): string {
  return join(tmpdir(), `tisyn-test-${randomUUID()}.ndjson`);
}

function yieldEvent(
  type: string,
  name: string,
  value: unknown,
  status: "ok" | "err" = "ok",
): YieldEvent {
  return {
    type: "yield",
    coroutineId: "root",
    description: { type, name },
    result:
      status === "ok"
        ? { status: "ok", value: value as import("@tisyn/ir").Json }
        : { status: "err", error: { message: String(value) } },
  };
}

effDescribe("FileJournalStream", () => {
  effIt("missing file returns empty readAll", function* () {
    const stream = new FileJournalStream(tmpJournalPath());
    const events = yield* stream.readAll();
    expect(events).toEqual([]);
  });

  effIt("append and readAll round-trip", function* () {
    const path = tmpJournalPath();
    const stream = new FileJournalStream(path);
    try {
      const event: DurableEvent = yieldEvent("app", "waitForUser", { message: "hi" });
      yield* stream.append(event);
      const events = yield* stream.readAll();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    } finally {
      try {
        yield* call(() => unlink(path));
      } catch {
        /* may not exist */
      }
    }
  });

  effIt("multiple appends persist in order", function* () {
    const path = tmpJournalPath();
    const stream = new FileJournalStream(path);
    try {
      const e1 = yieldEvent("app", "waitForUser", { message: "first" });
      const e2 = yieldEvent("llm", "sample", { message: "second" });
      yield* stream.append(e1);
      yield* stream.append(e2);
      const events = yield* stream.readAll();
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(e1);
      expect(events[1]).toEqual(e2);
    } finally {
      try {
        yield* call(() => unlink(path));
      } catch {
        /* may not exist */
      }
    }
  });

  effIt("persists across new stream instances", function* () {
    const path = tmpJournalPath();
    try {
      const stream1 = new FileJournalStream(path);
      yield* stream1.append(yieldEvent("app", "waitForUser", { message: "hi" }));

      const stream2 = new FileJournalStream(path);
      const events = yield* stream2.readAll();
      expect(events).toHaveLength(1);
      expect((events[0] as YieldEvent).description.name).toBe("waitForUser");
    } finally {
      try {
        yield* call(() => unlink(path));
      } catch {
        /* may not exist */
      }
    }
  });
});
