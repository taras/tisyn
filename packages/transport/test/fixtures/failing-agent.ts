import { main } from "effection";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { createProtocolServer } from "../../src/protocol-server.js";
import { createStdioAgentTransport } from "../../src/stdio-agent.js";

const failing = agent("failing", {
  boom: operation<void, never>(),
});

await main(function* () {
  const impl = implementAgent(failing, {
    *boom() {
      throw new Error("kaboom");
    },
  });
  const server = createProtocolServer(impl);
  yield* server.use(createStdioAgentTransport());
});
