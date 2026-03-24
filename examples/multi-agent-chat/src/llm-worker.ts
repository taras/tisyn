import { spawn, createQueue } from "effection";
import { workerMain } from "@effectionx/worker";
import { agent, operation, implementAgent } from "@tisyn/agent";
import { parseHostMessage } from "@tisyn/protocol";
import type { HostMessage, AgentMessage } from "@tisyn/protocol";
import { createProtocolServer } from "@tisyn/transport";

const llm = agent("l-l-m", {
  sample: operation<
    {
      input: {
        history: Array<{ role: string; content: string }>;
        message: string;
      };
    },
    { message: string }
  >(),
});

const impl = implementAgent(llm, {
  *sample({ input }) {
    return { message: `Echo: ${input.message}` };
  },
});

const server = createProtocolServer(impl);

workerMain<HostMessage, void, void, void, AgentMessage, void>(function* ({ messages, send }) {
  const queue = createQueue<HostMessage, void>();

  yield* spawn(function* () {
    yield* messages.forEach(function* (raw) {
      queue.add(parseHostMessage(JSON.parse(JSON.stringify(raw))));
    });
    queue.close();
  });

  yield* server.use({
    *receive() {
      return queue;
    },
    *send(agentMsg) {
      yield* send(agentMsg);
    },
  });
});
