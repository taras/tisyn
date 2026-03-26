import { describe as effDescribe, it as effIt } from "@effectionx/vitest";
import { describe, it, expect } from "vitest";
import { call } from "effection";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { DurableEvent, YieldEvent } from "@tisyn/kernel";
import { FileJournalStream } from "../src/file-journal-stream.js";
import { reconstructHistory } from "../src/reconstruct-history.js";

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
      const event: DurableEvent = yieldEvent("browser", "waitForUser", { message: "hi" });
      yield* stream.append(event);
      const events = yield* stream.readAll();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    } finally {
      try { yield* call(() => unlink(path)); } catch { /* may not exist */ }
    }
  });

  effIt("multiple appends persist in order", function* () {
    const path = tmpJournalPath();
    const stream = new FileJournalStream(path);
    try {
      const e1 = yieldEvent("browser", "waitForUser", { message: "first" });
      const e2 = yieldEvent("llm", "sample", { message: "second" });
      yield* stream.append(e1);
      yield* stream.append(e2);
      const events = yield* stream.readAll();
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(e1);
      expect(events[1]).toEqual(e2);
    } finally {
      try { yield* call(() => unlink(path)); } catch { /* may not exist */ }
    }
  });

  effIt("persists across new stream instances", function* () {
    const path = tmpJournalPath();
    try {
      const stream1 = new FileJournalStream(path);
      yield* stream1.append(yieldEvent("browser", "waitForUser", { message: "hi" }));

      const stream2 = new FileJournalStream(path);
      const events = yield* stream2.readAll();
      expect(events).toHaveLength(1);
      expect((events[0] as YieldEvent).description.name).toBe("waitForUser");
    } finally {
      try { yield* call(() => unlink(path)); } catch { /* may not exist */ }
    }
  });
});

describe("reconstructHistory", () => {
  it("empty events returns empty history", () => {
    expect(reconstructHistory([])).toEqual([]);
  });

  it("complete pair produces user + assistant entries", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", { message: "hello" }),
      yieldEvent("llm", "sample", { message: "hi back" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi back" },
    ]);
  });

  it("multiple pairs in order", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", { message: "a" }),
      yieldEvent("llm", "sample", { message: "b" }),
      yieldEvent("browser", "waitForUser", { message: "c" }),
      yieldEvent("llm", "sample", { message: "d" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
    ]);
  });

  it("trailing unmatched waitForUser is ignored", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", { message: "a" }),
      yieldEvent("llm", "sample", { message: "b" }),
      yieldEvent("browser", "waitForUser", { message: "orphan" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("non-ok results are ignored", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", "error msg", "err"),
      yieldEvent("browser", "waitForUser", { message: "real" }),
      yieldEvent("llm", "sample", { message: "reply" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "real" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("close events are ignored", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", { message: "a" }),
      { type: "close", coroutineId: "root", result: { status: "ok", value: null } },
      yieldEvent("llm", "sample", { message: "b" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("events with matching name but wrong type are ignored", () => {
    const events: DurableEvent[] = [
      yieldEvent("other", "waitForUser", { message: "wrong agent" }),
      yieldEvent("browser", "waitForUser", { message: "right" }),
      yieldEvent("other", "sample", { message: "wrong agent" }),
      yieldEvent("llm", "sample", { message: "correct" }),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "right" },
      { role: "assistant", content: "correct" },
    ]);
  });

  it("interleaved state events do not disrupt pairing", () => {
    const events: DurableEvent[] = [
      yieldEvent("browser", "waitForUser", { message: "hi" }),
      yieldEvent("state", "getHistory", []),
      yieldEvent("llm", "sample", { message: "hello" }),
      yieldEvent("state", "recordTurn", null),
    ];
    expect(reconstructHistory(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});
