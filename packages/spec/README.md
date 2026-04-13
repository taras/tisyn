# @tisyn/spec

Authoring, normalizing, indexing, and validating the Tisyn specification corpus.

`@tisyn/spec` owns the specification data model itself: authored TypeScript DSL
constructors, normalization into canonical JSON artifacts, registry
construction from normalized artifacts, validation/coverage/readiness queries,
and traversal helpers. It has zero `@tisyn/*` runtime dependencies — only
`vitest` for tests and `node:crypto` for hashing.

## Public API (§11)

### Authoring (§11.1)

PascalCase constructors for the spec data model:

- Specs: `Spec`, `Section`, `Rule`, `Invariant`, `ErrorCode`, `Concept`, `Term`
- Relationships: `DependsOn`, `Amends`, `Complements`, `ImplementsSpec`
- Amendments: `Amendment`, `ChangedSection`, `UnchangedSection`
- Test plans: `TestPlan`, `TestCategory`, `TestCase`, `Covers`, `NonTest`, `Ambiguity`
- Enums: `Status`, `Strength`, `Tier`, `EvidenceTier`, `ChangeType`, `Resolution`

### Normalization (§11.2)

```ts
normalizeSpec(module: SpecModule): NormalizeResult<NormalizedSpecModule>
normalizeTestPlan(module: TestPlanModule): NormalizeResult<NormalizedTestPlanModule>
```

Normalization runs structural validation, then (for specs) computes section
numbering, rule locations, and a content hash. Failures return
`{ ok: false, errors }` rather than throwing.

### Registry (§11.2)

```ts
buildRegistry(
  specs: readonly NormalizedSpecModule[],
  testPlans: readonly NormalizedTestPlanModule[],
): SpecRegistry
```

`SpecRegistry` is a set of `ReadonlyMap` indices: specs, test plans, rule
locations, error-code locations, concept locations, and term authority.

### Validation (§11.3)

```ts
validateCorpus(registry: SpecRegistry): ValidationReport
checkCoverage(registry: SpecRegistry, specId: string): CoverageReport
isReady(registry: SpecRegistry, specId: string): boolean
```

`validateCorpus` runs V1..V9 and returns structured errors and warnings with
no throws. `checkCoverage` narrows to one spec and lists uncovered rules.
`isReady` AND-combines spec status, companion plan presence, coverage
cleanliness, and unresolved ambiguities.

### Traversal (§11.4)

```ts
walkSections(module, visitor)
collectRules(module)
collectErrorCodes(module)
collectTerms(module)
```

Depth-first pre-order traversal of authored modules.

## Testing

```
pnpm --filter @tisyn/spec test
```

Every test name carries its `SS-*` identifier from
`spec-system-test-plan.source.md` so conformance is visible in test output.
