// Unit tests for the deterministic spec-Markdown renderer.

import { describe, expect, test } from "vitest";
import {
  Complements,
  Concept,
  DependsOn,
  ErrorCode,
  ImplementsSpec,
  Invariant,
  Rule,
  Section,
  Spec,
  Term,
} from "../constructors.ts";
import { Status, Strength } from "../enums.ts";
import { normalizeSpec } from "../normalize.ts";
import type { NormalizedSpecModule, SpecModule } from "../types.ts";
import { GENERATED_BANNER, renderSpecMarkdown } from "./render-spec.ts";

function norm(m: SpecModule): NormalizedSpecModule {
  const r = normalizeSpec(m);
  if (!r.ok) {
    throw new Error(`normalize failed: ${JSON.stringify(r.errors)}`);
  }
  return r.value;
}

describe("renderSpecMarkdown", () => {
  test("renders title, one section, one rule, one error code", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "Spec X",
        version: "0.1.0",
        status: Status.Active,
        sections: [
          Section({
            id: "1",
            title: "Overview",
            normative: true,
            prose: "Describes thing.",
          }),
        ],
        rules: [
          Rule({
            id: "X-1-R1",
            section: "1",
            strength: Strength.MUST,
            statement: "the thing must exist",
          }),
        ],
        errorCodes: [ErrorCode({ code: "X-E1", section: "1", trigger: "thing missing" })],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md.startsWith(`${GENERATED_BANNER}\n`)).toBe(true);
    expect(md).toContain("# Spec X");
    expect(md).toContain("## 1. Overview");
    expect(md).toContain("Describes thing.");
    expect(md).toContain("- **MUST** — the thing must exist");
    expect(md).toContain("- **X-E1** — thing missing");
    // Rule IDs are authoring-only: never rendered.
    expect(md).not.toContain("X-1-R1");
  });

  test("heading depth increases with nesting", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [
          Section({
            id: "1",
            title: "Top",
            normative: true,
            prose: "",
            subsections: [
              Section({
                id: "1.1",
                title: "Child",
                normative: true,
                prose: "",
                subsections: [Section({ id: "1.1.1", title: "Grand", normative: true, prose: "" })],
              }),
            ],
          }),
        ],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("## 1. Top");
    expect(md).toContain("### 1.1. Child");
    expect(md).toContain("#### 1.1.1. Grand");
  });

  test("empty rule/errorCode/etc lists emit prose only", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "1", title: "Only", normative: true, prose: "p." })],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("## 1. Only");
    expect(md).toContain("p.");
    expect(md).not.toContain("- **");
  });

  test("optional rule prose renders as indented line", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "1", title: "S", normative: true, prose: "" })],
        rules: [
          Rule({
            id: "X-1-R1",
            section: "1",
            strength: Strength.MUST,
            statement: "statement",
            prose: "extra explanation",
          }),
        ],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("- **MUST** — statement");
    expect(md).toContain("  extra explanation");
  });

  test("all relationship arrays populated renders bold label lines", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        dependsOn: [DependsOn("other-a")],
        complements: [Complements("other-b")],
        implements: [ImplementsSpec("other-c")],
        sections: [Section({ id: "1", title: "S", normative: true, prose: "" })],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("**Depends on:** other-a");
    expect(md).toContain("**Complements:** other-b");
    expect(md).toContain("**Implements:** other-c");
  });

  test("is deterministic: same input → byte-equal output", () => {
    const build = () =>
      norm(
        Spec({
          id: "sp-x",
          title: "X",
          version: "0.1.0",
          status: Status.Active,
          sections: [
            Section({ id: "1", title: "A", normative: true, prose: "p." }),
            Section({ id: "2", title: "B", normative: true, prose: "q." }),
          ],
          rules: [
            Rule({
              id: "X-1-R1",
              section: "1",
              strength: Strength.MUST,
              statement: "a",
            }),
            Rule({
              id: "X-2-R1",
              section: "2",
              strength: Strength.SHOULD,
              statement: "b",
            }),
          ],
        }),
      );
    const a = renderSpecMarkdown(build());
    const b = renderSpecMarkdown(build());
    expect(a).toBe(b);
  });

  test("concept, invariant, and term bullets render", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "1", title: "S", normative: true, prose: "" })],
        concepts: [Concept({ name: "widget", section: "1", description: "a thing" })],
        invariants: [Invariant({ id: "X-INV-1", section: "1", statement: "always A" })],
        terms: [Term({ term: "gadget", section: "1", definition: "a different thing" })],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("- **widget** — a thing");
    expect(md).toContain("- **X-INV-1** — always A");
    expect(md).toContain("- **gadget** — a different thing");
  });

  test("error code with requiredContent renders nested bullets", () => {
    const spec = norm(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "1", title: "S", normative: true, prose: "" })],
        errorCodes: [
          ErrorCode({
            code: "X-E1",
            section: "1",
            trigger: "bad thing",
            requiredContent: ["reason", "path"],
          }),
        ],
      }),
    );
    const md = renderSpecMarkdown(spec);
    expect(md).toContain("- **X-E1** — bad thing");
    expect(md).toContain("  - reason");
    expect(md).toContain("  - path");
  });
});
