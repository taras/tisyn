/**
 * Tests for createJournalStream in @tisyn/cli startup.
 *
 * Focused on the memory / file / missing-path / unknown-kind
 * branches. File-backed journaling is exercised end-to-end in
 * the @tisyn/spec verify-corpus e2e suite; this file pins the
 * synchronous dispatch that maps ResolvedJournal → DurableStream.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "@effectionx/vitest";
import { afterEach, expect } from "vitest";
import { call, type Operation } from "effection";
import { FileStream, InMemoryStream } from "@tisyn/durable-streams";
import type { ResolvedJournal } from "@tisyn/runtime";
import { createJournalStream } from "./startup.js";
import { CliError } from "./load-descriptor.js";

const temps: string[] = [];

function* makeTempDir(): Operation<string> {
  const dir = yield* call(() => mkdtemp(join(tmpdir(), "startup-journal-test-")));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("createJournalStream", () => {
  it("kind: memory returns an InMemoryStream", function* () {
    const journal: ResolvedJournal = { kind: "memory" };
    const stream = createJournalStream(journal);
    expect(stream).toBeInstanceOf(InMemoryStream);
  });

  it("kind: file with an absolute path returns a FileStream that round-trips", function* () {
    const dir = yield* makeTempDir();
    const path = join(dir, "journal.ndjson");
    const journal: ResolvedJournal = { kind: "file", path };
    const stream = createJournalStream(journal);
    expect(stream).toBeInstanceOf(FileStream);

    const event = {
      type: "yield" as const,
      coroutineId: "c1",
      description: { type: "external", name: "a.op" },
      result: { status: "ok" as const, value: null },
    };
    yield* stream.append(event);
    const events = yield* stream.readAll();
    expect(events).toEqual([event]);
  });

  it("kind: file with missing path throws CliError", function* () {
    const journal: ResolvedJournal = { kind: "file" };
    expect(() => createJournalStream(journal)).toThrow(CliError);
    expect(() => createJournalStream(journal)).toThrow(/journal\.file requires a non-empty path/);
  });

  it("kind: unknown throws CliError", function* () {
    const journal: ResolvedJournal = { kind: "bogus" };
    expect(() => createJournalStream(journal)).toThrow(CliError);
    expect(() => createJournalStream(journal)).toThrow(/Unknown journal kind 'bogus'/);
  });
});
