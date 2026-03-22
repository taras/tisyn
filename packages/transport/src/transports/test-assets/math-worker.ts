import { agent, operation } from "@tisyn/agent";
import { runWorkerAgent } from "@tisyn/transport/worker-agent";

const math = agent("math-worker", {
  double: operation<{ value: number }, number>(),
});

runWorkerAgent(math, {
  *double({ value }) {
    return value * 2;
  },
});
