import type { EffectDescription } from "./events.js";

export function parseEffectId(id: string): EffectDescription {
  const dotIndex = id.indexOf(".");
  if (dotIndex === -1) {
    return { type: id, name: id };
  }
  return {
    type: id.substring(0, dotIndex),
    name: id.substring(dotIndex + 1),
  };
}
