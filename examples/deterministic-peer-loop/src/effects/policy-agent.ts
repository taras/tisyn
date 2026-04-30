import { agent, operation } from "@tisyn/agent";
import type { PolicyDecision, RequestedEffect } from "../types.js";

export const Policy = () =>
  agent("effects-policy", {
    decide: operation<{ effect: RequestedEffect }, PolicyDecision>(),
  });
