import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";

const Output = () =>
  agent("output", {
    log: operation<{ label: string; text: string }, void>(),
  });

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(Output(), {
      *log({ label, text }) {
        console.log(`\n── ${label} ──\n${text}\n`);
      },
    }),
  };
}
