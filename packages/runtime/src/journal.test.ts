import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Dispatch } from "@tisyn/agent";
import type { YieldEvent } from "@tisyn/kernel";

describe("Journal", () => {
  it("yield event written before resume", function* () {
    const stream = new InMemoryStream();

    const appendTimestamps: Array<{ event: string; appendCount: number }> = [];

    // Wrap stream.append to track ordering
    const originalAppend = stream.append.bind(stream);
    stream.append = function* (event) {
      yield* originalAppend(event);
      appendTimestamps.push({
        event:
          event.type === "yield" ? `yield:${(event as YieldEvent).description.name}` : event.type,
        appendCount: stream.appendCount,
      });
    };

    yield* Dispatch.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([_effectId, _data]: [string, any]) {
        return 42;
      },
    });

    // IR: single effect a.op
    const ir = {
      tisyn: "eval",
      id: "a.op",
      data: [],
    };

    const { result, journal } = yield* execute({
      ir: ir as never,
      stream,
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
