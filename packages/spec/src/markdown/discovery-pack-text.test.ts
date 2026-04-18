// SS-RN renderDiscoveryPackText — a derived text projection of the typed
// DiscoveryPack value.

import { describe, expect, it } from "vitest";
import { renderDiscoveryPackText } from "./discovery-pack-text.ts";
import { generateDiscoveryPack } from "../queries/projection.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import { fixtureAlpha, fixtureAlphaPlan, fixtureBeta } from "../__fixtures__/index.ts";

describe("SS-RN discovery-pack-text", () => {
  it("projects the pack into a readable summary", () => {
    const r = buildTestRegistry([fixtureAlpha, fixtureBeta], [fixtureAlphaPlan]);
    const pack = generateDiscoveryPack(r, { now: () => "2026-01-01T00:00:00Z" });
    const text = renderDiscoveryPackText(pack);
    expect(text).toMatch(/# Discovery Pack \(full\)/);
    expect(text).toMatch(/- fixture-alpha — active/);
    expect(text).toMatch(/## Consistency/);
    expect(text).toMatch(/cycles: false/);
  });
});
