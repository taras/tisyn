// Pilot-local output binding. Streams labeled log blocks to stdout in
// the `── <label> ──\n<text>\n` format. The e2e smoke test greps on
// that literal substring — keep the template byte-stable.

import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { outputDeclaration } from "./agents.ts";

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(outputDeclaration, {
      *log(input) {
        const { label, text } = input as unknown as { label: string; text: string };
        console.log(`\n── ${label} ──\n${text}\n`);
        return null as unknown as Val;
      },
    }),
  };
}
