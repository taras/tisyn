import { main, suspend } from "effection";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { createProtocolServer } from "../../src/protocol-server.js";
import { createStdioAgentTransport } from "../../src/stdio-agent.js";

const slow = agent("slow", {
  work: operation<void, void>(),
});

await main(function* () {
  const impl = implementAgent(slow, {
    *work() {
      yield* suspend();
    },
  });
  const server = createProtocolServer(impl);
  yield* server.use(createStdioAgentTransport());
});
