import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { EffectHandler } from "./handler-agent.js";
import type { Val } from "../schemas.js";

export type SyncEffectHandler = (input: Val) => Val;

export class UnknownEffectError extends Error {
  override name = "UnknownEffectError";
  constructor(public readonly effectId: string) {
    super(`Unknown effect: ${effectId}`);
  }
}

export interface HandlerBindingConfig {
  handlers?: ReadonlyArray<[string, SyncEffectHandler]>;
}

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const raw = (config?.handlers as HandlerBindingConfig["handlers"] | undefined) ?? [];
  const registry = new Map<string, SyncEffectHandler>(raw);

  return {
    transport: inprocessTransport(EffectHandler(), {
      *invoke({ effectId, data }) {
        const handler = registry.get(effectId);
        if (!handler) {
          const err = new UnknownEffectError(effectId);
          return {
            ok: false as const,
            error: { name: err.name, message: err.message },
          };
        }
        try {
          return { ok: true as const, result: handler(data) };
        } catch (err) {
          const e = err as Error;
          return {
            ok: false as const,
            error: { name: e.name, message: e.message },
          };
        }
      },
    }),
  };
}
