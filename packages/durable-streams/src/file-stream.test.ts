import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "@effectionx/vitest";
import { afterEach, expect } from "vitest";
import { call } from "effection";
import type { CloseEvent, DurableEvent, YieldEvent } from "@tisyn/kernel";
import { FileStream } from "./file-stream.js";

function yieldEvent(name: string, coroutineId = "c1"): YieldEvent {
  return {
    type: "yield",
    coroutineId,
    description: { type: "external", name },
    result: { status: "ok", value: null },
  };
}

function closeEvent(coroutineId = "c1"): CloseEvent {
  return {
    type: "close",
    coroutineId,
    result: { status: "ok", value: null },
  };
}

describe("FileStream", () => {
  let tempDir: string;

  beforeEach(function* () {
    tempDir = yield* call(() => mkdtemp(join(tmpdir(), "file-stream-test-")));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("append + readAll round-trips a single event", function* () {
    const stream = new FileStream(join(tempDir, "journal.ndjson"));
    const event = yieldEvent("a.op");
    yield* stream.append(event);
    const events = yield* stream.readAll();
    expect(events).toEqual([event]);
  });

  it("multiple appends preserve order", function* () {
    const stream = new FileStream(join(tempDir, "journal.ndjson"));
    const e1 = yieldEvent("first", "c1");
    const e2 = yieldEvent("second", "c2");
    const e3 = closeEvent("c3");
    yield* stream.append(e1);
    yield* stream.append(e2);
    yield* stream.append(e3);
    const events = yield* stream.readAll();
    expect(events).toEqual([e1, e2, e3]);
  });

  it("missing file reads as empty", function* () {
    const stream = new FileStream(join(tempDir, "never-written.ndjson"));
    const events = yield* stream.readAll();
    expect(events).toEqual([]);
  });

  it("empty file reads as empty", function* () {
    const path = join(tempDir, "empty.ndjson");
    yield* call(() => writeFile(path, ""));
    const stream = new FileStream(path);
    const events = yield* stream.readAll();
    expect(events).toEqual([]);
  });

  it("trailing newline is tolerated", function* () {
    const path = join(tempDir, "trailing.ndjson");
    const e1 = yieldEvent("one");
    const e2 = closeEvent();
    const content = `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`;
    yield* call(() => writeFile(path, content));
    const stream = new FileStream(path);
    const events = yield* stream.readAll();
    expect(events).toEqual([e1, e2]);
  });

  it("malformed NDJSON raises a line-located error", function* () {
    const path = join(tempDir, "bad.ndjson");
    const e1 = yieldEvent("ok");
    const content = `${JSON.stringify(e1)}\nNOT-JSON\n`;
    yield* call(() => writeFile(path, content));
    const stream = new FileStream(path);
    let caught: unknown;
    try {
      yield* stream.readAll();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(path);
    expect(message).toContain(":2:");
  });

  it("parent directory is auto-created on first append", function* () {
    const nestedPath = join(tempDir, "a", "b", "c", "journal.ndjson");
    const stream = new FileStream(nestedPath);
    const event = yieldEvent("nested");
    yield* stream.append(event);
    const events = yield* stream.readAll();
    expect(events).toEqual([event]);
  });

  it("appends are durable across FileStream instances", function* () {
    const path = join(tempDir, "durable.ndjson");
    const first = new FileStream(path);
    const e1 = yieldEvent("a");
    const e2 = yieldEvent("b");
    yield* first.append(e1);
    yield* first.append(e2);

    const second = new FileStream(path);
    const events = yield* second.readAll();
    expect(events).toEqual([e1, e2]);

    // Confirm the type is DurableEvent (compile-time assertion)
    const _check: DurableEvent = events[0]!;
    void _check;
  });
});
