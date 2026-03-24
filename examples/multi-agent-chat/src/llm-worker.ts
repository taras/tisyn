import { workerMain } from "@effectionx/worker";
import { implementAgent } from "@tisyn/agent";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseHostMessage } from "@tisyn/protocol";
import { createProtocolServer } from "@tisyn/transport";
import { createQueue, spawn } from "effection";
import { Llm } from "./workflow.generated.ts";

const impl = implementAgent(Llm(), {
  *sample({ input }) {
    return { message: `Echo: ${input.message}` };
  },
});

const server = createProtocolServer(impl);

await workerMain<HostMessage, void, void, void, AgentMessage, void>(function* ({
  messages,
  send,
}) {
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
