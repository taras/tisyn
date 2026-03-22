import { main } from "effection";
import { agent, operation } from "@tisyn/agent";
import { runStdioAgent } from "../../src/stdio-agent.js";

const math = agent("math", {
  double: operation<{ value: number }, number>(),
});

await main(function* () {
  yield* runStdioAgent(math, {
    *double({ value }) {
      return value * 2;
    },
  });
});
