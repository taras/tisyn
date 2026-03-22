import { agent, operation } from "@tisyn/agent";
import { runWorkerAgent } from "@tisyn/transport/worker-agent";

const failing = agent("failing-worker", {
  boom: operation<void, never>(),
});

runWorkerAgent(failing, {
  *boom() {
    throw new Error("worker-kaboom");
  },
});
