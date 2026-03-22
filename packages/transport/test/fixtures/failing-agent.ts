import { main } from "effection";
import { agent, operation } from "@tisyn/agent";
import { runStdioAgent } from "../../src/stdio-agent.js";

const failing = agent("failing", {
  boom: operation<void, never>(),
});

await main(function* () {
  yield* runStdioAgent(failing, {
    *boom() {
      throw new Error("kaboom");
    },
  });
});
