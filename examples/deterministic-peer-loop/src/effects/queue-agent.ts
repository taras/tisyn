import { agent, operation } from "@tisyn/agent";
import type { RequestedEffect } from "../types.js";

export const EffectsQueue = () =>
  agent("effects-queue", {
    seed: operation<{ effects: RequestedEffect[] }, void>(),
    shift: operation<Record<string, never>, { effect: RequestedEffect | null }>(),
  });
