// Pilot-local output binding. Streams labeled log blocks to stdout in
// the `── <label> ──\n<text>\n` format. The e2e smoke test greps on
// that literal substring — keep the template byte-stable.
//
// The workflow body calls `Output().log({ label, text })` through an
// ambient contract, and the compiler wraps the single argument as
// `{ input: { label, text } }` using the ambient param name — so the
// handler destructures `{ input }` and then pulls `label`/`text` out.

import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { outputDeclaration } from "./agents.ts";

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(outputDeclaration, {
      *log(payload) {
        const { input } = payload as unknown as {
          input: { label: string; text: string };
        };
        const { label, text } = input;
        console.log(`\n── ${label} ──\n${text}\n`);
        return null as unknown as Val;
      },
    }),
  };
}
