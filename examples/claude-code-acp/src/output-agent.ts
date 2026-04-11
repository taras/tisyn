import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";

const Output = () =>
  agent("output", {
    log: operation<{ input: { label: string; text: string } }, void>(),
  });

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(Output(), {
      *log({ input }) {
        console.log(`\n── ${input.label} ──\n${input.text}\n`);
      },
    }),
  };
}
