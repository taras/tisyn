// Static corpus manifest per §7.3 of
// specs/tisyn-spec-system-specification.md (I10). Acquisition discovers
// registered corpus modules from this explicit list, not from directory
// scanning. Each entry names a single registered id and the loaders for its
// spec and (optional) companion test plan.
//
// Adding a spec to the corpus requires adding an entry here. The shape of the
// manifest is implementation-determined (§7.3); this project uses a TypeScript
// import list because it is typed end-to-end and its presence in the
// compilation set is enforced by `tsc`.

import type { SpecModule, TestPlanModule } from "./types.ts";

export interface ManifestEntry {
  readonly id: string;
  readonly loadSpec: () => Promise<SpecModule>;
  readonly loadPlan?: () => Promise<TestPlanModule>;
}

// Registered modules. The list grows when a spec is ported to v2 and its
// corpus module lands under `packages/spec/corpus/<id>/`.
export const manifest: readonly ManifestEntry[] = [
  {
    id: "tisyn-cli",
    loadSpec: () => import("../corpus/tisyn-cli/spec.ts").then((m) => m.tisynCliSpec),
    loadPlan: () => import("../corpus/tisyn-cli/test-plan.ts").then((m) => m.tisynCliTestPlan),
  },
];
