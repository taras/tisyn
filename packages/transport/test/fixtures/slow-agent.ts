import { main, suspend } from "effection";
import { agent, operation } from "@tisyn/agent";
import { runStdioAgent } from "../../src/stdio-agent.js";

const slow = agent("slow", {
  work: operation<void, void>(),
});

await main(function* () {
  yield* runStdioAgent(slow, {
    *work() {
      yield* suspend();
    },
  });
});
