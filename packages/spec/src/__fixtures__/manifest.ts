// Build an in-memory manifest for tests. The real manifest (src/manifest.ts)
// uses dynamic imports; the test manifest wraps already-loaded modules.

import type { ManifestEntry } from "../manifest.ts";
import type { SpecModule, TestPlanModule } from "../types.ts";

export interface FixtureEntry {
  readonly id: string;
  readonly spec: SpecModule;
  readonly plan?: TestPlanModule;
}

export function buildTestManifest(
  entries: readonly FixtureEntry[],
): readonly ManifestEntry[] {
  return entries.map((e) => ({
    id: e.id,
    loadSpec: () => Promise.resolve(e.spec),
    ...(e.plan !== undefined ? { loadPlan: () => Promise.resolve(e.plan!) } : {}),
  }));
}
