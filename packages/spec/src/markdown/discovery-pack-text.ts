// §11.3 renderDiscoveryPackText — compact text projection of a DiscoveryPack.
// The canonical form is the typed DiscoveryPack value from
// generateDiscoveryPack; this rendering is a derived projection only.

import type { DiscoveryPack } from "../types.ts";

export function renderDiscoveryPackText(pack: DiscoveryPack): string {
  const out: string[] = [];
  out.push(`# Discovery Pack (${pack.scopeKind})`);
  out.push(`_Generated: ${pack.generatedAt}_`);
  out.push(`_Specs: ${pack.specCount}_`);
  out.push("");

  out.push("## Specs");
  for (const s of pack.specs) {
    const impl = s.implementationPackage !== undefined ? ` [${s.implementationPackage}]` : "";
    const ready = s.ready ? "ready" : "not-ready";
    out.push(
      `- ${s.id}${impl} — ${s.status} — ${ready} — coverage ${s.coverage.covered}/${s.coverage.total}`,
    );
  }
  out.push("");

  if (pack.terms.length > 0) {
    out.push("## Terms");
    for (const t of pack.terms) {
      out.push(`- **${t.term}** (${t.specId}) — ${t.definition}`);
    }
    out.push("");
  }

  if (pack.openQuestions.length > 0) {
    out.push("## Open Questions");
    for (const oq of pack.openQuestions) {
      const blocks = oq.blocksTarget !== undefined ? ` (blocks ${oq.blocksTarget})` : "";
      out.push(`- [${oq.id}] (${oq.specId}) [${oq.status}]${blocks}`);
    }
    out.push("");
  }

  out.push("## Consistency");
  out.push(`- stale references: ${pack.consistency.staleReferences}`);
  out.push(`- term conflicts: ${pack.consistency.termConflicts}`);
  out.push(`- error-code collisions: ${pack.consistency.errorCodeCollisions}`);
  out.push(`- duplicate rules: ${pack.consistency.duplicateRules}`);
  out.push(`- cycles: ${pack.consistency.cycles}`);
  out.push("");

  return out.join("\n");
}
