import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { Output } from "./assist.generated.js";

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(Output(), {
      *log({ input }) {
        console.log(`\n── ${input.label} ──\n${input.text}\n`);
      },
    }),
  };
}
