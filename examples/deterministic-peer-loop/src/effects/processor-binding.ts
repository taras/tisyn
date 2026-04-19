import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { EffectsProcessor } from "./processor-agent.js";
import { createPolicy, type PolicyEntry, type PolicyMap } from "./policy.js";
import type { Val } from "../schemas.js";
import type { EffectRequestRecord, RequestedEffect } from "../types.js";

export type EffectHandler = (input: Val) => Promise<Val> | Val;
export type HandlerRegistry = ReadonlyMap<string, EffectHandler>;

export class UnknownEffectError extends Error {
  readonly name = "UnknownEffectError";
  constructor(public readonly effectId: string) {
    super(`Unknown effect: ${effectId}`);
  }
}

export interface ProcessorBindingConfig {
  policyMap?: ReadonlyArray<[string, PolicyEntry]>;
  registry?: ReadonlyArray<[string, EffectHandler]>;
}

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const rawPolicy =
    (config?.policyMap as ProcessorBindingConfig["policyMap"] | undefined) ?? [];
  const rawRegistry =
    (config?.registry as ProcessorBindingConfig["registry"] | undefined) ?? [];
  const policyMap: PolicyMap = new Map(rawPolicy);
  const registry: HandlerRegistry = new Map(rawRegistry);
  const policy = createPolicy(policyMap);

  return {
    transport: inprocessTransport(EffectsProcessor(), {
      *processAll({ effects, turnIndex, requestor }) {
        const records: EffectRequestRecord[] = [];
        for (const effect of effects) {
          const record = yield* call(() =>
            Promise.resolve(processOne(effect, turnIndex, requestor, policy.decide, registry)),
          );
          records.push(record);
        }
        return records;
      },
    }),
  };
}

async function processOne(
  effect: RequestedEffect,
  turnIndex: number,
  requestor: "opus" | "gpt",
  decide: (effect: RequestedEffect) => ReturnType<ReturnType<typeof createPolicy>["decide"]>,
  registry: HandlerRegistry,
): Promise<EffectRequestRecord> {
  const decision = decide(effect);
  if (decision.kind === "executed") {
    const handler = registry.get(effect.id);
    if (!handler) {
      return {
        turnIndex,
        requestor,
        effect,
        disposition: "rejected",
        dispositionAt: turnIndex,
        error: { name: "UnknownEffectError", message: new UnknownEffectError(effect.id).message },
      };
    }
    try {
      const result = await Promise.resolve(handler(effect.input));
      return {
        turnIndex,
        requestor,
        effect,
        disposition: "executed",
        dispositionAt: turnIndex,
        ...(result !== undefined ? { result } : {}),
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return {
        turnIndex,
        requestor,
        effect,
        disposition: "executed",
        dispositionAt: turnIndex,
        error: { name: err.name, message: err.message },
      };
    }
  } else if (decision.kind === "rejected") {
    return {
      turnIndex,
      requestor,
      effect,
      disposition: "rejected",
      dispositionAt: turnIndex,
      error: { name: "PolicyRejected", message: decision.reason },
    };
  } else if (decision.kind === "deferred") {
    return {
      turnIndex,
      requestor,
      effect,
      disposition: "deferred",
      dispositionAt: turnIndex,
    };
  } else {
    return {
      turnIndex,
      requestor,
      effect,
      disposition: "surfaced_to_taras",
      dispositionAt: turnIndex,
    };
  }
}
