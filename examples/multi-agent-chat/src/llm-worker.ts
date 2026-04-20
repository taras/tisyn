import { workerMain } from "@effectionx/worker";
import { agent, implementAgent, operation } from "@tisyn/agent";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseHostMessage } from "@tisyn/protocol";
import { createProtocolServer } from "@tisyn/transport";
import { createQueue, spawn } from "effection";
import { logInfo } from "./logger.ts";

const Llm = () =>
  agent("llm", {
    sample: operation<
      {
        history: Array<{ role: string; content: string }>;
        message: string;
      },
      { message: string }
    >(),
  });

const impl = implementAgent(Llm(), {
  *sample({ history, message }) {
    logInfo("llm", "sample request", {
      message,
      historyLength: history.length,
    });
    const result = { message: `Echo: ${message}` };
    logInfo("llm", "sample response", { message: result.message });
    return result;
  },
});

const server = createProtocolServer(impl);

await workerMain<HostMessage, void, void, void, AgentMessage, void>(function* ({ messages, send }) {
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
