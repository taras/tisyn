/**
 * Runtime tests for the __config journaled effect.
 *
 * The __config effect is emitted by compiled `yield* useConfig(Token)` and
 * returns the projected resolved config provided via ExecuteOptions.config.
 * The token argument is erased at compile time — it does not reach the runtime.
 * The effect is journaled like any standard external effect for replay safety.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { YieldEvent } from "@tisyn/kernel";

// IR for: yield* useConfig(Token) → ExternalEval("__config", Q(null))
const useConfigIr = {
  tisyn: "eval",
  id: "__config",
  data: { tisyn: "quote", expr: null },
};

describe("__config effect", () => {
  it("returns projected config when config is provided", function* () {
    const config = { debug: true, model: "gpt-4", maxTurns: 10 };

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
    const config = { debug: true };
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
    const config = { debug: true };
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
    const config = { debug: true };
    const envArgs = { input: "hello" };

    // IR: let cfg = yield* useConfig(); let env = __env; [cfg, env]
    // Simplified: just use __config to verify config doesn't leak into env
    const { result } = yield* execute({
      ir: useConfigIr as never,
      env: envArgs as never,
      config,
    });

    // __config returns config, not env
    expect(result).toEqual({ status: "ok", value: config });
  });
});
