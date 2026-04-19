import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { Policy } from "./policy-agent.js";
import { createPolicy, type PolicyEntry, type PolicyMap } from "./policy.js";

export interface PolicyBindingConfig {
  policyMap?: ReadonlyArray<[string, PolicyEntry]>;
}

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const raw =
    (config?.policyMap as PolicyBindingConfig["policyMap"] | undefined) ?? [];
  const policyMap: PolicyMap = new Map(raw);
  const policy = createPolicy(policyMap);

  return {
    transport: inprocessTransport(Policy(), {
      *decide({ effect }) {
        return policy.decide(effect);
      },
    }),
  };
}
