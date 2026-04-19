import { agent, operation } from "@tisyn/agent";
import type { Val } from "../schemas.js";
import type { InvokeOutcome } from "../types.js";

export const EffectHandler = () =>
  agent("effect-handler", {
    invoke: operation<{ effectId: string; data: Val }, InvokeOutcome>(),
  });
