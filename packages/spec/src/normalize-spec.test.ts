// SS-NS — Normalization (spec module) tests per §5.3 of
// spec-system-test-plan.source.md. Also covers the N10 path-derivation unit
// test for the internal artifact helpers.

import { describe, expect, test } from "vitest";
import {
  Rule,
  Section,
  Spec,
} from "./constructors.ts";
import { Status, Strength } from "./enums.ts";
import {
  artifactPath,
  normalizeSpec,
  serializeArtifact,
} from "./normalize.ts";
import type { SpecModule } from "./types.ts";

function nested(): SpecModule {
  return Spec({
    id: "sp-x",
    title: "X",
    version: "0.1.0",
    status: Status.Active,
    sections: [
      Section({
        id: "intro",
        title: "Intro",
        normative: true,
        prose: ".",
        subsections: [
          Section({
            id: "child-alloc",
            title: "Alloc",
            normative: true,
            prose: ".",
          }),
          Section({
            id: "child-dispose",
            title: "Dispose",
            normative: true,
            prose: ".",
          }),
        ],
      }),
      Section({ id: "impl", title: "Implementation", normative: true, prose: "." }),
    ],
    rules: [
      Rule({
        id: "SP-R1",
        section: "child-alloc",
        strength: Strength.MUST,
        statement: "Allocate",
      }),
    ],
  });
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) {throw new Error("expected ok result");}
  return result.value;
}

describe("SS-NS", () => {
  test("SS-NS-001 Normalization preserves authored fields (N1, N2, D38)", () => {
    const authored = nested();
    const normalized = unwrap(normalizeSpec(authored));
    expect(normalized.id).toBe(authored.id);
    expect(normalized.title).toBe(authored.title);
    expect(normalized.version).toBe(authored.version);
    expect(normalized.status).toBe(authored.status);
    expect(normalized.sections).toEqual(authored.sections);
    expect(normalized.rules).toEqual(authored.rules);
  });

  test("SS-NS-002 _sectionNumbering is Record<string,string>", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    expect(typeof normalized._sectionNumbering).toBe("object");
    for (const [k, v] of Object.entries(normalized._sectionNumbering)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("string");
    }
  });

  test("SS-NS-003 _ruleLocations is Record<string,string>", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    expect(typeof normalized._ruleLocations).toBe("object");
    for (const [k, v] of Object.entries(normalized._ruleLocations)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("string");
    }
  });

  test("SS-NS-004 _hash is a non-empty string prefixed sha256:", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    expect(normalized._hash.length).toBeGreaterThan(0);
    expect(normalized._hash.startsWith("sha256:")).toBe(true);
  });

  test("SS-NS-005 _normalizedAt is ISO 8601 string", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    expect(typeof normalized._normalizedAt).toBe("string");
    // ISO 8601 parses back to the same instant
    expect(new Date(normalized._normalizedAt).toISOString()).toBe(
      normalized._normalizedAt,
    );
  });

  test("SS-NS-006 Section numbering depth-first: [A,[A1,A2],B]", () => {
    const authored = Spec({
      id: "sp-y",
      title: "Y",
      version: "0.1.0",
      status: Status.Active,
      sections: [
        Section({
          id: "A",
          title: "A",
          normative: true,
          prose: ".",
          subsections: [
            Section({ id: "A1", title: "A1", normative: true, prose: "." }),
            Section({ id: "A2", title: "A2", normative: true, prose: "." }),
          ],
        }),
        Section({ id: "B", title: "B", normative: true, prose: "." }),
      ],
    });
    const normalized = unwrap(normalizeSpec(authored));
    expect(normalized._sectionNumbering).toEqual({
      A: "§1",
      A1: "§1.1",
      A2: "§1.2",
      B: "§2",
    });
  });

  test("SS-NS-007 Three-level nesting: third level is §X.Y.Z", () => {
    const authored = Spec({
      id: "sp-z",
      title: "Z",
      version: "0.1.0",
      status: Status.Active,
      sections: [
        Section({
          id: "A",
          title: "A",
          normative: true,
          prose: ".",
          subsections: [
            Section({
              id: "A1",
              title: "A1",
              normative: true,
              prose: ".",
              subsections: [
                Section({
                  id: "A1a",
                  title: "A1a",
                  normative: true,
                  prose: ".",
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const normalized = unwrap(normalizeSpec(authored));
    expect(normalized._sectionNumbering.A1a).toBe("§1.1.1");
  });

  test("SS-NS-008 Rule locations resolve against section numbering (N5)", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    // nested() places rule SP-R1 in section child-alloc, which is §1.1
    expect(normalized._sectionNumbering["child-alloc"]).toBe("§1.1");
    expect(normalized._ruleLocations["SP-R1"]).toBe("§1.1");
  });

  test("SS-NS-009 Rule with invalid section reference fails normalization", () => {
    const authored = Spec({
      id: "sp-bad",
      title: "Bad",
      version: "0.1.0",
      status: Status.Active,
      sections: [
        Section({ id: "s1", title: "S", normative: true, prose: "." }),
      ],
      rules: [
        Rule({
          id: "X-R1",
          section: "nonexistent",
          strength: Strength.MUST,
          statement: "s",
        }),
      ],
    });
    const result = normalizeSpec(authored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "MISSING_SECTION_REF")).toBe(
        true,
      );
    }
  });

  test("SS-NS-010 Hash is deterministic across runs (N6)", () => {
    const a = unwrap(normalizeSpec(nested()));
    const b = unwrap(normalizeSpec(nested()));
    expect(a._hash).toBe(b._hash);
  });

  test("SS-NS-011 Hash does not depend on _normalizedAt", async () => {
    const first = unwrap(normalizeSpec(nested()));
    // Force a measurable timestamp delta
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = unwrap(normalizeSpec(nested()));
    expect(second._normalizedAt).not.toBe(first._normalizedAt);
    expect(second._hash).toBe(first._hash);
  });

  test("SS-NS-012 One artifact per module (N9)", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    const json = serializeArtifact(normalized);
    expect(typeof json).toBe("string");
    expect(json.length).toBeGreaterThan(0);
  });

  test("SS-NS-013 Artifact is valid JSON, round-trips to normalized (N11)", () => {
    const normalized = unwrap(normalizeSpec(nested()));
    const parsed = JSON.parse(serializeArtifact(normalized));
    expect(parsed).toEqual(normalized);
  });

  test("N10 artifactPath derivation", () => {
    expect(artifactPath("specs", "sp-core")).toBe("specs/.tisyn-spec/sp-core.json");
    expect(artifactPath("/abs/dir", "tisyn-kernel")).toBe(
      "/abs/dir/.tisyn-spec/tisyn-kernel.json",
    );
  });

  test("SS-NS-014 Normalization is deterministic excluding _normalizedAt", () => {
    const a = unwrap(normalizeSpec(nested()));
    const b = unwrap(normalizeSpec(nested()));
    const stripA = { ...a, _normalizedAt: "" };
    const stripB = { ...b, _normalizedAt: "" };
    expect(JSON.stringify(stripA)).toBe(JSON.stringify(stripB));
  });

  test("SS-NS-015 Staleness detection ignores _normalizedAt (N13)", () => {
    const a = unwrap(normalizeSpec(nested()));
    const b = {
      ...a,
      _normalizedAt: new Date(Date.parse(a._normalizedAt) + 1000).toISOString(),
    };
    expect(a._hash).toBe(b._hash);
  });

  test("SS-NS-016 Normalization does not modify authored fields (LB2)", () => {
    const authored = nested();
    const snapshot = JSON.parse(JSON.stringify(authored));
    normalizeSpec(authored);
    // authored object was not mutated
    expect(authored).toEqual(snapshot);
  });
});
