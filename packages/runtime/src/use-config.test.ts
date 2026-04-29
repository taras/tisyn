/**
 * Runtime tests for the __config journaled effect.
 *
 * The __config effect is emitted by compiled `yield* Config.useConfig(Token)` and
 * returns the resolved config projection from the runtime config-scope.
 * The token argument is erased at compile time — it does not reach the runtime.
 * The effect is journaled like any standard external effect for replay safety.
 *
 * Tests seed config via execute({ config }) which internally sets the config context.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import type { Val } from "@tisyn/ir";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { YieldEvent } from "@tisyn/kernel";

// IR for: yield* Config.useConfig(Token) → ExternalEval("__config", Q(null))
const useConfigIr = {
  tisyn: "eval",
  id: "__config",
  data: { tisyn: "quote", expr: null },
};

describe("__config effect", () => {
  it("returns projected config when config is provided", function* () {
    const config = { debug: true, model: "gpt-4", maxTurns: 10 } as Val;

    const { result } = yield* execute({
      ir: useConfigIr as never,
      config,
    });

    expect(result).toEqual({ status: "ok", value: config });
  });

  it("returns null when config is not provided", function* () {
    const { result } = yield* execute({
      ir: useConfigIr as never,
    });

    expect(result).toEqual({ status: "ok", value: null });
  });

  it("is journaled as a YieldEvent", function* () {
    const config = { debug: true } as Val;
    const stream = new InMemoryStream();

    const { journal } = yield* execute({
      ir: useConfigIr as never,
      config,
      stream,
    });

    // Should have a yield event for __config and a close event
    const yieldEvents = journal.filter((e): e is YieldEvent => e.type === "yield");
    expect(yieldEvents).toHaveLength(1);
    expect(yieldEvents[0]!.description.name).toBe("__config");
    expect(yieldEvents[0]!.result).toEqual({ status: "ok", value: config });
  });

  it("on replay with same config: no divergence", function* () {
    const config = { debug: true } as Val;
    const stream = new InMemoryStream();

    // First execution — populates the journal
    yield* execute({
      ir: useConfigIr as never,
      config,
      stream,
    });

    // Second execution — replays from the same stream
    const { result } = yield* execute({
      ir: useConfigIr as never,
      config,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: config });
  });

  it("invocation args (env) remain distinct from config", function* () {
    const config = { debug: true } as Val;
    const envArgs = { input: "hello" };

    const { result } = yield* execute({
      ir: useConfigIr as never,
      config,
      env: envArgs as never,
    });

    // __config returns config, not env
    expect(result).toEqual({ status: "ok", value: config });
  });

  // RD-PD-076: __config is non-canonicalizable (per spec §3.1.1 / §9.5.8).
  // YieldEvent.description omits both `input` and `sha`. Mirrors RD-PD-070
  // for stream.subscribe.
  it("RD-PD-076: __config writes neither input nor sha", function* () {
    const config = { debug: true } as Val;
    const stream = new InMemoryStream();

    const { journal } = yield* execute({
      ir: useConfigIr as never,
      config,
      stream,
    });

    const yieldEvents = journal.filter((e): e is YieldEvent => e.type === "yield");
    expect(yieldEvents).toHaveLength(1);
    expect(yieldEvents[0]!.description).toEqual({ type: "__config", name: "__config" });
    expect(yieldEvents[0]!.description.input).toBeUndefined();
    expect(yieldEvents[0]!.description.sha).toBeUndefined();
  });

  // RD-PD-077: stored __config replays with type/name only — no sha
  // comparison, missing sha is expected. Mirrors RD-PD-071/RD-PD-057 for
  // stream.subscribe. (Direct replay test: write a journal whose stored
  // __config entry omits sha, then re-execute against it.)
  it("RD-PD-077: __config replays with type/name only (no sha required)", function* () {
    const config = { debug: true } as Val;

    // Stored __config entry without sha (the new on-disk format).
    const stored = [
      {
        type: "yield" as const,
        coroutineId: "root",
        description: { type: "__config", name: "__config" },
        result: { status: "ok" as const, value: config },
      },
    ];
    const stream = new InMemoryStream(stored);

    const { result } = yield* execute({
      ir: useConfigIr as never,
      config,
      stream,
    });

    // Replay succeeds: missing sha is expected for non-canonicalizable.
    expect(result).toEqual({ status: "ok", value: config });
  });
});
