// buildRegistry per §6.1–§6.3 of tisyn-spec-system-specification.source.md.
//
// buildRegistry is a pure function: it takes a mixed superset of normalized
// modules plus an explicit Scope and owns all filtered-scope semantics. It
// performs no I/O and never mutates its inputs. The returned registry is
// deep-frozen so downstream code cannot violate RI1.
//
// Scope rules (§6.2 R5/R6/R7, §6.3 RI4):
//
// • scope.kind === "full"
//     → every input spec is in-scope; every input plan is in-scope.
// • scope.kind === "filtered"
//     → specs whose `id ∈ scope.specIds` are in-scope; plans whose
//       `validatesSpec ∈ scope.specIds` come along automatically (§7.1).
//       Specs whose id is requested but absent from the input contribute
//       nothing (unresolved targets are acceptable per A6 / RI3).
//
// Cross-module id collision is a construction-time error (SS-RG-016): it is
// the registry half of the D2 corpus-wide uniqueness check that normalization
// explicitly defers (§5.3 V3).

import type {
  ConceptLocation,
  CorpusRegistry,
  ErrorCodeLocation,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  OpenQuestionLocation,
  RelationshipEdge,
  RuleLocation,
  Scope,
  Section,
  TermLocation,
} from "./types.ts";

// Internal extras exposed to analysis queries (findDuplicateRules,
// findTermConflicts, findErrorCodeCollisions). These record the pre-precedence
// collision pool so analysis queries can report both sides even though the
// primary index only stores the winning entry per R3/R4.
interface InternalExtras {
  readonly allRuleLocations: readonly RuleLocation[];
  readonly allTermLocations: readonly TermLocation[];
  readonly allConceptLocations: readonly ConceptLocation[];
  readonly allErrorCodeLocations: readonly ErrorCodeLocation[];
  readonly allOpenQuestionLocations: readonly OpenQuestionLocation[];
}

const registryExtras = new WeakMap<CorpusRegistry, InternalExtras>();

export function getInternalExtras(registry: CorpusRegistry): InternalExtras | undefined {
  return registryExtras.get(registry);
}

// Real `ReadonlyMap` wrapper that does not extend `Map`. Patching mutating
// methods on a live `Map` instance (the earlier `freezeMapInPlace` strategy)
// leaves the prototype chain intact — `Map.prototype.set.call(instance, ...)`
// bypasses the own-property override and mutates the internal `[[MapData]]`
// slot directly. A wrapper class without the internal slot defeats that
// bypass: `Map.prototype.set.call(wrapper, ...)` throws `TypeError:
// Method Map.prototype.set called on incompatible receiver`.
class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #inner: Map<K, V>;
  constructor(source: Iterable<readonly [K, V]>) {
    this.#inner = new Map(source);
  }
  get size(): number {
    return this.#inner.size;
  }
  has(key: K): boolean {
    return this.#inner.has(key);
  }
  get(key: K): V | undefined {
    return this.#inner.get(key);
  }
  keys(): MapIterator<K> {
    return this.#inner.keys();
  }
  values(): MapIterator<V> {
    return this.#inner.values();
  }
  entries(): MapIterator<[K, V]> {
    return this.#inner.entries();
  }
  forEach(
    cb: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#inner.forEach((v, k) => cb.call(thisArg, v, k, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#inner[Symbol.iterator]();
  }
  get [Symbol.toStringTag](): string {
    return "ReadonlyMap";
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null) return value;
  if (typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const element of value) deepFreeze(element);
  } else {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function isSpec(
  m: NormalizedSpecModule | NormalizedTestPlanModule,
): m is NormalizedSpecModule {
  return m.tisyn_spec === "spec";
}

// Depth-first walk of a section tree collecting locations for the four
// section-contained entity kinds. The containing spec's id is stamped on
// every location so downstream queries need no parent lookup.
function collectFromSections(
  specId: string,
  sections: readonly Section[],
  rules: RuleLocation[],
  terms: TermLocation[],
  concepts: ConceptLocation[],
  errorCodes: ErrorCodeLocation[],
): void {
  for (const section of sections) {
    if (section.rules !== undefined) {
      for (const rule of section.rules) {
        rules.push({ specId, sectionId: section.id, rule });
      }
    }
    if (section.termDefinitions !== undefined) {
      for (const definition of section.termDefinitions) {
        terms.push({ specId, sectionId: section.id, definition });
      }
    }
    if (section.conceptExports !== undefined) {
      for (const concept of section.conceptExports) {
        concepts.push({ specId, sectionId: section.id, concept });
      }
    }
    if (section.errorCodes !== undefined) {
      for (const errorCode of section.errorCodes) {
        errorCodes.push({ specId, sectionId: section.id, errorCode });
      }
    }
    if (section.subsections !== undefined) {
      collectFromSections(specId, section.subsections, rules, terms, concepts, errorCodes);
    }
  }
}

// Kahn's algorithm over `depends-on` and `amends` edges. On cycles, residual
// nodes are appended in stable id-sorted order (R6, SS-RG-009).
function topoSort(
  specIds: readonly string[],
  edges: readonly { readonly source: string; readonly target: string }[],
): readonly string[] {
  const inScope = new Set(specIds);
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const id of specIds) {
    incoming.set(id, new Set());
    outgoing.set(id, new Set());
  }
  // Edge source=A, target=B means "A depends-on/amends B". B is a dependency
  // of A, so B must come first in dependencyOrder. Orient the Kahn graph so
  // `incoming` counts unresolved dependencies: A has incoming from B, B has
  // outgoing to A.
  for (const edge of edges) {
    if (!inScope.has(edge.source) || !inScope.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    outgoing.get(edge.target)!.add(edge.source);
    incoming.get(edge.source)!.add(edge.target);
  }

  const ready: string[] = [];
  for (const id of specIds) {
    if (incoming.get(id)!.size === 0) ready.push(id);
  }
  ready.sort();

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of outgoing.get(id)!) {
      const incs = incoming.get(next)!;
      incs.delete(id);
      if (incs.size === 0) {
        const insertAt = ready.findIndex((r) => r > next);
        if (insertAt === -1) ready.push(next);
        else ready.splice(insertAt, 0, next);
      }
    }
  }

  if (order.length < specIds.length) {
    const placed = new Set(order);
    const residual = specIds.filter((id) => !placed.has(id)).slice().sort();
    for (const id of residual) order.push(id);
  }
  return order;
}

export function buildRegistry(
  modules: readonly (NormalizedSpecModule | NormalizedTestPlanModule)[],
  scope: Scope,
): CorpusRegistry {
  const allSpecs: NormalizedSpecModule[] = [];
  const allPlans: NormalizedTestPlanModule[] = [];
  for (const m of modules) {
    if (isSpec(m)) allSpecs.push(m);
    else allPlans.push(m);
  }

  // Cross-module id collision (SS-RG-016 / D2 corpus-wide half of V3).
  const seenSpecIds = new Map<string, NormalizedSpecModule>();
  for (const s of allSpecs) {
    const prior = seenSpecIds.get(s.id);
    if (prior !== undefined && prior !== s) {
      throw new Error(
        `buildRegistry: duplicate spec id "${s.id}" — two distinct modules share this id`,
      );
    }
    seenSpecIds.set(s.id, s);
  }
  const seenPlanIds = new Map<string, NormalizedTestPlanModule>();
  for (const p of allPlans) {
    const prior = seenPlanIds.get(p.id);
    if (prior !== undefined && prior !== p) {
      throw new Error(
        `buildRegistry: duplicate test-plan id "${p.id}" — two distinct modules share this id`,
      );
    }
    seenPlanIds.set(p.id, p);
  }

  // Compute in-scope subsets. buildRegistry owns all filtered-scope semantics;
  // out-of-scope modules are silently dropped, unresolved requested ids
  // contribute nothing (A6 / RI3).
  let inScopeSpecs: NormalizedSpecModule[];
  let inScopePlans: NormalizedTestPlanModule[];
  if (scope.kind === "full") {
    inScopeSpecs = allSpecs.slice();
    inScopePlans = allPlans.slice();
  } else {
    const want = new Set(scope.specIds);
    inScopeSpecs = allSpecs.filter((s) => want.has(s.id));
    inScopePlans = allPlans.filter((p) => want.has(p.validatesSpec));
  }

  // Dependency order (R6) from in-scope specs' depends-on/amends edges.
  const depEdges: { source: string; target: string }[] = [];
  for (const s of inScopeSpecs) {
    for (const r of s.relationships) {
      if (r.type === "depends-on" || r.type === "amends") {
        depEdges.push({ source: s.id, target: r.target });
      }
    }
  }
  const dependencyOrder = topoSort(
    inScopeSpecs.map((s) => s.id),
    depEdges,
  );
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < dependencyOrder.length; i++) orderIndex.set(dependencyOrder[i]!, i);

  // Collect all locations per in-scope spec.
  const allRules: RuleLocation[] = [];
  const allTerms: TermLocation[] = [];
  const allConcepts: ConceptLocation[] = [];
  const allErrorCodes: ErrorCodeLocation[] = [];
  const allOpenQuestions: OpenQuestionLocation[] = [];
  for (const s of inScopeSpecs) {
    collectFromSections(s.id, s.sections, allRules, allTerms, allConcepts, allErrorCodes);
    if (s.openQuestions !== undefined) {
      for (const oq of s.openQuestions) {
        allOpenQuestions.push({ specId: s.id, openQuestion: oq });
      }
    }
  }

  // Precedence rule (R3/R4): earlier in dependencyOrder wins on key collision.
  function installWithPrecedence<K, V extends { readonly specId: string }>(
    index: Map<K, V>,
    key: K,
    location: V,
  ): void {
    const prior = index.get(key);
    if (prior === undefined) {
      index.set(key, location);
      return;
    }
    const priorOrder = orderIndex.get(prior.specId) ?? Number.MAX_SAFE_INTEGER;
    const newOrder = orderIndex.get(location.specId) ?? Number.MAX_SAFE_INTEGER;
    if (newOrder < priorOrder) {
      index.set(key, location);
    }
  }

  const ruleIndex = new Map<string, RuleLocation>();
  for (const loc of allRules) installWithPrecedence(ruleIndex, loc.rule.id, loc);

  const termIndex = new Map<string, TermLocation>();
  for (const loc of allTerms) installWithPrecedence(termIndex, loc.definition.term, loc);

  const conceptIndex = new Map<string, ConceptLocation>();
  for (const loc of allConcepts) installWithPrecedence(conceptIndex, loc.concept.name, loc);

  const errorCodeIndex = new Map<string, ErrorCodeLocation>();
  for (const loc of allErrorCodes) installWithPrecedence(errorCodeIndex, loc.errorCode.code, loc);

  const openQuestionIndex = new Map<string, OpenQuestionLocation>();
  for (const loc of allOpenQuestions)
    installWithPrecedence(openQuestionIndex, loc.openQuestion.id, loc);

  // Edges: one per Relationship on every in-scope spec (R5). Edges whose
  // target is out-of-scope are still emitted (RI3 / A6); edges from
  // out-of-scope specs are excluded by construction of `inScopeSpecs`.
  const edges: RelationshipEdge[] = [];
  for (const s of inScopeSpecs) {
    for (const r of s.relationships) {
      const edge: RelationshipEdge = r.qualifier !== undefined
        ? { source: s.id, target: r.target, type: r.type, qualifier: r.qualifier }
        : { source: s.id, target: r.target, type: r.type };
      edges.push(edge);
    }
  }

  const specs = new Map<string, NormalizedSpecModule>();
  for (const s of inScopeSpecs) specs.set(s.id, s);
  const plans = new Map<string, NormalizedTestPlanModule>();
  for (const p of inScopePlans) plans.set(p.id, p);

  // Preserve scope verbatim (R7 / I9). Freeze the specIds copy for filtered.
  const preservedScope: Scope =
    scope.kind === "full"
      ? { kind: "full" }
      : { kind: "filtered", specIds: deepFreeze([...scope.specIds]) };

  // RI1: surface real `ReadonlyMap` wrappers, not live `Map` instances. A
  // bare `Map` lets callers mutate it via `Map.prototype.set.call(map, ...)`
  // even when own-property `.set` is overridden. `ImmutableMap` has no
  // `[[MapData]]` slot, so the prototype-call bypass throws at runtime.
  const registry: CorpusRegistry = {
    specs: new ImmutableMap(specs),
    plans: new ImmutableMap(plans),
    ruleIndex: new ImmutableMap(ruleIndex),
    termIndex: new ImmutableMap(termIndex),
    conceptIndex: new ImmutableMap(conceptIndex),
    errorCodeIndex: new ImmutableMap(errorCodeIndex),
    openQuestionIndex: new ImmutableMap(openQuestionIndex),
    edges: deepFreeze(edges),
    dependencyOrder: deepFreeze([...dependencyOrder]),
    scope: deepFreeze(preservedScope),
  };

  Object.freeze(registry);
  for (const loc of allRules) deepFreeze(loc);
  for (const loc of allTerms) deepFreeze(loc);
  for (const loc of allConcepts) deepFreeze(loc);
  for (const loc of allErrorCodes) deepFreeze(loc);
  for (const loc of allOpenQuestions) deepFreeze(loc);

  registryExtras.set(registry, {
    allRuleLocations: allRules,
    allTermLocations: allTerms,
    allConceptLocations: allConcepts,
    allErrorCodeLocations: allErrorCodes,
    allOpenQuestionLocations: allOpenQuestions,
  });

  return registry;
}
