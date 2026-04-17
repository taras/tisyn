// normalizeSpec / normalizeTestPlan per §5.1 / §5.2 of
// tisyn-spec-system-specification.source.md.
//
// Both entry points return a NormalizeResult<T> rather than throwing
// (§5.1 "Normalization MUST NOT throw on structural failure. It MUST return an
// error result.", SS-NM-003, SS-NM-005). After structural validation passes,
// `_hash` is computed (N1 — canonical SHA-256 of the module with `_hash` and
// `_normalizedAt` stripped) and `_normalizedAt` is set to an ISO-8601 string
// (N2). The resulting module is deep-frozen to honor RI1 (the registry's
// immutability requirement applies to its member modules too).

import { computeHash } from "./hash.ts";
import { validateSpecStructural, validateTestPlanStructural } from "./structural.ts";
import type {
  NormalizeResult,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  SpecModule,
  TestPlanModule,
} from "./types.ts";

function deepFreeze<T>(value: T): T {
  if (value === null) return value;
  if (typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const element of value) deepFreeze(element);
  } else {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function normalizeSpec(module: SpecModule): NormalizeResult<NormalizedSpecModule> {
  const errors = validateSpecStructural(module);
  if (errors.length > 0) {
    return { status: "error", errors };
  }
  const hash = computeHash(module as unknown as Record<string, unknown>);
  const normalized: NormalizedSpecModule = {
    ...module,
    _hash: hash,
    _normalizedAt: new Date().toISOString(),
  };
  deepFreeze(normalized);
  return { status: "ok", value: normalized };
}

export function normalizeTestPlan(
  module: TestPlanModule,
): NormalizeResult<NormalizedTestPlanModule> {
  const errors = validateTestPlanStructural(module);
  if (errors.length > 0) {
    return { status: "error", errors };
  }
  const hash = computeHash(module as unknown as Record<string, unknown>);
  const normalized: NormalizedTestPlanModule = {
    ...module,
    _hash: hash,
    _normalizedAt: new Date().toISOString(),
  };
  deepFreeze(normalized);
  return { status: "ok", value: normalized };
}
