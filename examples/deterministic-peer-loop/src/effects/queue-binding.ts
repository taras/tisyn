import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { EffectsQueue } from "./queue-agent.js";
import type { RequestedEffect } from "../types.js";

export function createBinding(): LocalAgentBinding {
  let queue: RequestedEffect[] = [];
  return {
    transport: inprocessTransport(EffectsQueue(), {
      *seed({ effects }) {
        queue = [...effects];
      },
      *shift() {
        if (queue.length === 0) {
          return { effect: null };
        }
        const effect = queue[0];
        queue = queue.slice(1);
        return { effect };
      },
    }),
  };
}
