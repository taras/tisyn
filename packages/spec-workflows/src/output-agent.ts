// Pilot-local output binding. Streams labeled log blocks to stdout in
// the `── <label> ──\n<text>\n` format. The e2e smoke test greps on
// that literal substring — keep the template byte-stable.
//
// The workflow body calls `Output().log({ label, text })` through an
// ambient contract. The compiler passes the single argument through as
// the effect payload directly, so the handler receives
// `{ label, text }`.

import type { Operation } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { outputDeclaration } from "./agents.ts";

function* log(payload: Val): Operation<Val> {
  const { label, text } = payload as unknown as {
    label: string;
    text: string;
  };
  console.log(`\n── ${label} ──\n${text}\n`);
  return null as unknown as Val;
}

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(outputDeclaration, {
      log,
    }),
  };
}
