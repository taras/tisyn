// §8.5 Relationship queries.

import type { CorpusRegistry, ImpactEntry, Relationship, Section } from "../types.ts";

function walkProse(sections: readonly Section[], out: string[]): void {
  for (const section of sections) {
    out.push(section.prose);
    if (section.subsections !== undefined) {
      walkProse(section.subsections, out);
    }
  }
}

// Detect cross-spec §-references in prose text (§8.5.1). Current form is
// `§N` / `§N.M`; a source spec id prefix is not part of the pattern — this
// matches the spec's current wording, which leaves typed cross-spec refs as
// OQ1.
const SECTION_REF = /§(\d+(?:\.\d+)?)/g;

// §8.5 impactOf — direct dependents + test-plan references + prose §-refs.
// Scope-relative: impact from out-of-scope specs is not returned (§8.8).
export function impactOf(
  registry: CorpusRegistry,
  specId: string,
  sectionId?: string | number,
): readonly ImpactEntry[] {
  const out: ImpactEntry[] = [];

  // Direct depends-on / amends references.
  for (const source of registry.specs.values()) {
    for (const rel of source.relationships) {
      if (rel.target !== specId) {
        continue;
      }
      if (rel.type === "depends-on") {
        out.push({ specId: source.id, relationship: rel, impactType: "depends-on" });
      } else if (rel.type === "amends") {
        out.push({ specId: source.id, relationship: rel, impactType: "amends" });
      }
    }
  }

  // Test-plan references: a plan whose validatesSpec names our spec counts as
  // an impact when a sectionId is given, for callers narrowing an amendment.
  for (const plan of registry.plans.values()) {
    if (plan.validatesSpec !== specId) {
      continue;
    }
    // Synthesize a relationship for the entry shape; it's not an authored edge
    // but the contract demands a Relationship-typed payload.
    const syntheticRel: Relationship = { type: "depends-on", target: specId };
    out.push({
      specId: plan.id,
      relationship: syntheticRel,
      impactType: "test-references",
    });
  }

  // Prose §-references in other specs' section prose.
  for (const source of registry.specs.values()) {
    if (source.id === specId) {
      continue;
    }
    const proseChunks: string[] = [];
    walkProse(source.sections, proseChunks);
    const blob = proseChunks.join("\n");
    SECTION_REF.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECTION_REF.exec(blob)) !== null) {
      const referenced = match[1]!;
      if (sectionId !== undefined && String(sectionId) !== referenced) {
        continue;
      }
      out.push({
        specId: source.id,
        relationship: { type: "depends-on", target: specId },
        referencedSection: referenced,
        impactType: "prose-references",
      });
    }
  }
  return out;
}

// §8.5 transitiveDependencies — DFS over depends-on + amends.
export function transitiveDependencies(
  registry: CorpusRegistry,
  specId: string,
): readonly string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  function visit(id: string): void {
    const spec = registry.specs.get(id);
    if (spec === undefined) {
      return;
    }
    for (const rel of spec.relationships) {
      if (rel.type !== "depends-on" && rel.type !== "amends") {
        continue;
      }
      if (visited.has(rel.target)) {
        continue;
      }
      visited.add(rel.target);
      visit(rel.target);
      order.push(rel.target);
    }
  }
  visit(specId);
  return order;
}

// §8.5 dependencyOrder — passthrough of the registry's precomputed field.
export function dependencyOrder(registry: CorpusRegistry): readonly string[] {
  return registry.dependencyOrder;
}

// §8.5 hasCycles — re-run Kahn's on depends-on + amends edges over in-scope
// specs and return true when residual nodes remain.
export function hasCycles(registry: CorpusRegistry): boolean {
  const ids = [...registry.specs.keys()];
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const spec of registry.specs.values()) {
    for (const rel of spec.relationships) {
      if (rel.type !== "depends-on" && rel.type !== "amends") {
        continue;
      }
      if (!incoming.has(rel.target)) {
        continue;
      } // out-of-scope target
      if (spec.id === rel.target) {
        return true;
      } // self-loop is a cycle
      outgoing.get(spec.id)!.push(rel.target);
      incoming.set(rel.target, incoming.get(rel.target)! + 1);
    }
  }
  const ready: string[] = [];
  for (const [id, count] of incoming) {
    if (count === 0) {
      ready.push(id);
    }
  }
  let placed = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    placed++;
    for (const next of outgoing.get(id)!) {
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next)! === 0) {
        ready.push(next);
      }
    }
  }
  return placed < ids.length;
}
