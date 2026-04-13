// Traversal helpers per §11.4 of spec-system-specification.source.md.
// walkSections is depth-first pre-order; `path` includes the current section
// as its last element and `depth` is zero-based. collectRules /
// collectErrorCodes / collectTerms are thin walkSections drivers pushing into
// local arrays in source order with no de-duplication (that is a registry
// concern). All four operate on authored SpecModule, not normalized artifacts.

import type {
  ErrorCodeDeclaration,
  RuleDeclaration,
  SpecModule,
  SpecSection,
  TermDefinition,
} from "./types.ts";

type SectionVisitor = (
  section: SpecSection,
  path: readonly SpecSection[],
  depth: number,
) => void;

export function walkSections(module: SpecModule, visitor: SectionVisitor): void {
  function visit(
    section: SpecSection,
    path: SpecSection[],
    depth: number,
  ): void {
    const nextPath = [...path, section];
    visitor(section, nextPath, depth);
    for (const sub of section.subsections) {
      visit(sub, nextPath, depth + 1);
    }
  }
  for (const section of module.sections) {
    visit(section, [], 0);
  }
}

export function collectRules(module: SpecModule): readonly RuleDeclaration[] {
  // Rules live flat on the module (not on sections) but their section refs
  // point into the section tree. Walk order is section-source order: we emit
  // rules in the order the referenced sections are visited.
  const sectionIdOrder: string[] = [];
  walkSections(module, (s) => {
    sectionIdOrder.push(s.id);
  });
  const rulesBySection = new Map<string, RuleDeclaration[]>();
  for (const rule of module.rules) {
    const list = rulesBySection.get(rule.section) ?? [];
    list.push(rule);
    rulesBySection.set(rule.section, list);
  }
  const out: RuleDeclaration[] = [];
  for (const sectionId of sectionIdOrder) {
    const list = rulesBySection.get(sectionId);
    if (list !== undefined) out.push(...list);
  }
  return out;
}

export function collectErrorCodes(
  module: SpecModule,
): readonly ErrorCodeDeclaration[] {
  const sectionIdOrder: string[] = [];
  walkSections(module, (s) => {
    sectionIdOrder.push(s.id);
  });
  const codesBySection = new Map<string, ErrorCodeDeclaration[]>();
  for (const ec of module.errorCodes) {
    const list = codesBySection.get(ec.section) ?? [];
    list.push(ec);
    codesBySection.set(ec.section, list);
  }
  const out: ErrorCodeDeclaration[] = [];
  for (const sectionId of sectionIdOrder) {
    const list = codesBySection.get(sectionId);
    if (list !== undefined) out.push(...list);
  }
  return out;
}

export function collectTerms(module: SpecModule): readonly TermDefinition[] {
  const sectionIdOrder: string[] = [];
  walkSections(module, (s) => {
    sectionIdOrder.push(s.id);
  });
  const termsBySection = new Map<string, TermDefinition[]>();
  for (const term of module.terms) {
    const list = termsBySection.get(term.section) ?? [];
    list.push(term);
    termsBySection.set(term.section, list);
  }
  const out: TermDefinition[] = [];
  for (const sectionId of sectionIdOrder) {
    const list = termsBySection.get(sectionId);
    if (list !== undefined) out.push(...list);
  }
  return out;
}
