import type { PolicyDecision, RequestedEffect } from "../types.js";

export type HandlerKind = "executed" | "deferred" | "surfaced_to_taras";

export interface PolicyEntry {
  kind: HandlerKind;
  reason?: string;
}

export type PolicyMap = ReadonlyMap<string, PolicyEntry>;

export interface Policy {
  decide(entry: RequestedEffect): PolicyDecision;
}

export function createPolicy(map: PolicyMap): Policy {
  return {
    decide(entry) {
      const found = map.get(entry.id);
      if (!found) {
        return { kind: "rejected", reason: "unregistered" };
      }
      switch (found.kind) {
        case "executed":
          return { kind: "executed" };
        case "deferred":
          return { kind: "deferred", reason: found.reason };
        case "surfaced_to_taras":
          return { kind: "surfaced_to_taras", reason: found.reason };
      }
    },
  };
}

export const emptyPolicy: Policy = createPolicy(new Map());
