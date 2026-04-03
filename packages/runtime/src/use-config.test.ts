/**
 * Runtime tests for the __config journaled effect.
 *
 * The __config effect is emitted by compiled `yield* Config.useConfig(Token)` and
 * returns the resolved config projection from the runtime config-scope.
 * The token argument is erased at compile time — it does not reach the runtime.
 * The effect is journaled like any standard external effect for replay safety.
 *
 * Tests seed config via provideConfig() before calling execute().
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { provideConfig } from "./config-scope.js";
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
    const config = { debug: true, model: "gpt-4", maxTurns: 10 };

    yield* provideConfig(config);
    const { result } = yield* execute({
      ir: useConfigIr as never,
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
    const config = { debug: true };
    const stream = new InMemoryStream();

    yield* provideConfig(config);
    const { journal } = yield* execute({
      ir: useConfigIr as never,
      stream,
    });

    // Should have a yield event for __config and a close event
    const yieldEvents = journal.filter((e): e is YieldEvent => e.type === "yield");
    expect(yieldEvents).toHaveLength(1);
    expect(yieldEvents[0]!.description.name).toBe("__config");
    expect(yieldEvents[0]!.result).toEqual({ status: "ok", value: config });
  });

  it("on replay with same config: no divergence", function* () {
    const config = { debug: true };
    const stream = new InMemoryStream();

    // First execution — populates the journal
    yield* provideConfig(config);
    yield* execute({
      ir: useConfigIr as never,
      stream,
    });

    // Second execution — replays from the same stream
    const { result } = yield* execute({
      ir: useConfigIr as never,
      stream,
    });

    expect(result).toEqual({ status: "ok", value: config });
  });

  it("invocation args (env) remain distinct from config", function* () {
    const config = { debug: true };
    const envArgs = { input: "hello" };

    yield* provideConfig(config);
    const { result } = yield* execute({
      ir: useConfigIr as never,
      env: envArgs as never,
    });

    // __config returns config, not env
    expect(result).toEqual({ status: "ok", value: config });
  });
});
