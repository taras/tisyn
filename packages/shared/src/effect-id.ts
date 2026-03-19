/**
 * Effect ID parsing.
 *
 * See Kernel Specification §4.6 and Conformance Suite §4.6.
 *
 * Split on first dot:
 *   "fraud-detector.fraudCheck" → { type: "fraud-detector", name: "fraudCheck" }
 *   "sleep" → { type: "sleep", name: "sleep" }
 *   "a.b.c" → { type: "a", name: "b.c" }
 *
 * Total, deterministic, one-way.
 */

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
