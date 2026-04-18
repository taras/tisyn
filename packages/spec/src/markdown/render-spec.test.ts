// SS-RN: renderSpecMarkdown is deterministic, sorts relationships, banners
// Markdown by default, and uses §N prefix on numeric section ids.

import { describe, expect, it } from "vitest";
import { renderSpecMarkdown } from "./render-spec.ts";
import { GENERATED_BANNER, stripBanner } from "./banner.ts";
import { fixtureAlpha, fixtureDelta } from "../__fixtures__/index.ts";

describe("SS-RN render-spec", () => {
  it("is deterministic across calls", () => {
    expect(renderSpecMarkdown(fixtureAlpha)).toBe(renderSpecMarkdown(fixtureAlpha));
  });

  it("prefixes numeric section ids with §N", () => {
    const out = renderSpecMarkdown(fixtureAlpha);
    expect(out).toMatch(/## §1 Core/);
  });

  it("includes the generated banner by default and strips cleanly", () => {
    const out = renderSpecMarkdown(fixtureAlpha);
    expect(out.startsWith(GENERATED_BANNER)).toBe(true);
    const stripped = stripBanner(out);
    expect(stripped.startsWith("# Fixture Alpha")).toBe(true);
  });

  it("emits a relationship line per relationship", () => {
    const out = renderSpecMarkdown(fixtureDelta);
    expect(out).toMatch(/- depends-on: fixture-alpha/);
    expect(out).toMatch(/- complements: fixture-missing/);
  });

  it("omits banner when includeBanner is false", () => {
    const out = renderSpecMarkdown(fixtureAlpha, { includeBanner: false });
    expect(out.startsWith("# Fixture Alpha")).toBe(true);
  });
});
