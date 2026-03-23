import { main } from "effection";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { createProtocolServer } from "../../src/protocol-server.js";
import { createStdioAgentTransport } from "../../src/stdio-agent.js";

const math = agent("math", {
  double: operation<{ value: number }, number>(),
});

await main(function* () {
  const impl = implementAgent(math, {
    *double({ value }) {
      return value * 2;
    },
  });
  const server = createProtocolServer(impl);
  yield* server.use(createStdioAgentTransport());
});
