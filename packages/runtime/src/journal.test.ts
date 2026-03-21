import { describe, it, expect } from "vitest";
import { run } from "effection";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { AgentRegistry } from "@tisyn/agent";
import type { YieldEvent } from "@tisyn/kernel";

describe("Journal", () => {
  it("yield event written before resume", async () => {
    const stream = new InMemoryStream();
    const agents = new AgentRegistry();

    const appendTimestamps: Array<{ event: string; appendCount: number }> = [];

    // Wrap stream.append to track ordering
    const originalAppend = stream.append.bind(stream);
    stream.append = function* (event) {
      yield* originalAppend(event);
      appendTimestamps.push({
        event: event.type === "yield"
          ? `yield:${(event as YieldEvent).description.name}`
          : event.type,
        appendCount: stream.appendCount,
      });
    };

    // biome-ignore lint/correctness/useYield: mock
    agents.register("a", function* () {
      return 42;
    });

    // IR: single effect a.op
    const ir = {
      tisyn: "eval",
      id: "a.op",
      data: [],
    };

    const { result, journal } = await run(function* () {
      return yield* execute({
        ir: ir as never,
        stream,
        agents,
      });
    });

    expect(result).toEqual({ status: "ok", value: 42 });

    // Yield was appended to stream (appendCount > 0)
    expect(stream.appendCount).toBeGreaterThanOrEqual(2); // yield + close

    // The yield event was written before the close event
    expect(appendTimestamps[0]!.event).toBe("yield:op");
    expect(appendTimestamps[1]!.event).toBe("close");

    // Journal matches stream ordering
    expect(journal[0]!.type).toBe("yield");
    expect(journal[1]!.type).toBe("close");
  });
});
