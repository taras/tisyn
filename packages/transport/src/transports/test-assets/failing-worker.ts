import { spawn, createQueue } from "effection";
import { workerMain } from "@effectionx/worker";
import { agent, operation } from "@tisyn/agent";
import { parseHostMessage } from "@tisyn/protocol";
import type { HostMessage, AgentMessage } from "@tisyn/protocol";
import { runAgentHandler } from "@tisyn/transport";

const failing = agent("failing-worker", {
  boom: operation<void, never>(),
});

workerMain<HostMessage, void, void, void, AgentMessage, void>(
  function* ({ messages, send }) {
    const queue = createQueue<HostMessage, void>();

    yield* spawn(function* () {
      yield* messages.forEach(function* (raw) {
        queue.add(parseHostMessage(JSON.parse(JSON.stringify(raw))));
      });
      queue.close();
    });

    yield* runAgentHandler(failing, {
      *boom() {
        throw new Error("worker-kaboom");
      },
    }, {
      receive: queue,
      *send(agentMsg) {
        yield* send(agentMsg);
      },
    });
  },
);
