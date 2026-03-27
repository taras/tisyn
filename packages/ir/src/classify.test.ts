import { describe, it, expect } from "vitest";
import { classify, isStructural, isExternal, isCompoundExternal } from "./classify.js";
import { STRUCTURAL_IDS, COMPOUND_EXTERNAL_IDS } from "./derived.js";

describe("classify", () => {
  for (const id of STRUCTURAL_IDS) {
    it(`classify("${id}") returns "structural"`, () => {
      expect(classify(id)).toBe("structural");
    });
  }

  it("classifies unknown IDs as external", () => {
    expect(classify("sleep")).toBe("external");
    expect(classify("order-service.fetch")).toBe("external");
    expect(classify("some-random-thing")).toBe("external");
  });

  it("all and race are external", () => {
    expect(classify("all")).toBe("external");
    expect(classify("race")).toBe("external");
  });
});

describe("isStructural", () => {
  it("returns true for all structural IDs", () => {
    for (const id of STRUCTURAL_IDS) {
      expect(isStructural(id)).toBe(true);
    }
  });

  it("returns false for external IDs", () => {
    expect(isStructural("sleep")).toBe(false);
    expect(isStructural("all")).toBe(false);
  });
});

describe("isExternal", () => {
  it("returns true for non-structural IDs", () => {
    expect(isExternal("sleep")).toBe(true);
    expect(isExternal("all")).toBe(true);
  });

  it("returns false for structural IDs", () => {
    expect(isExternal("let")).toBe(false);
    expect(isExternal("add")).toBe(false);
  });
});

describe("isCompoundExternal", () => {
  for (const id of COMPOUND_EXTERNAL_IDS) {
    it(`"${id}" is compound external`, () => {
      expect(isCompoundExternal(id)).toBe(true);
    });
  }

  it("sleep is not compound external", () => {
    expect(isCompoundExternal("sleep")).toBe(false);
  });

  it("structural IDs are not compound external", () => {
    expect(isCompoundExternal("let")).toBe(false);
  });
});

describe("STRUCTURAL_IDS", () => {
  it("has 27 entries", () => {
    expect(STRUCTURAL_IDS).toHaveLength(27);
  });
});
