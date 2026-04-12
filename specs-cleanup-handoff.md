# Specs Directory Normalization — Handoff

Work in the main repo checkout for tisyn.

Task:
Normalize the `specs/` directory — canonical filenames, fold the standalone converge amendment into its parent specs, normalize the timebox test-plan filename, and strip draft/revision/changelog artifacts so every spec and test plan reads as the current final state.

---

## Task 1: Canonical versionless filenames

Rename these files using `git mv`:

| Current | Canonical |
|---|---|
| `specs/tisyn-specification-1.0.md` | `specs/tisyn-system-specification.md` |
| `specs/tisyn-agent-specification-1.1.0.md` | `specs/tisyn-agent-specification.md` |
| `specs/tisyn-compiler-specification-1.1.0.md` | `specs/tisyn-compiler-specification.md` |
| `specs/tisyn-authoring-layer-spec.md` | `specs/tisyn-authoring-layer-specification.md` |
| `specs/tisyn-compound-concurrency-spec.md` | `specs/tisyn-compound-concurrency-specification.md` |
| `specs/tisyn-browser-test-orchestration-spec.md` | `specs/tisyn-browser-test-orchestration-specification.md` |
| `specs/tisyn-timebox-converge-conformance-plan.md` | `specs/tisyn-timebox-test-plan.md` |

Filename pattern:
- Specifications: `tisyn-<topic>-specification.md`
- Test plans: `tisyn-<topic>-test-plan.md`
- `tisyn-architecture.md` stays as-is (not a specification)

---

## Task 2: Fold `tisyn-converge-amendment.md` into parent specs

The converge amendment amends three parent specs and depends on timebox. Distribute its content, then delete the amendment file.

### Into `specs/tisyn-timebox-specification.md` — converge's semantic/timebox-facing content

This is converge's canonical behavioral home. Fold these amendment sections as new sections of the timebox spec:

- **Amendment §3** (Relationship to timebox) — converge is defined in terms of timebox
- **Amendment §6** (Lowering strategy) — converge lowers to a timebox node with recursive Fn+Call polling loop; includes §6.1 conceptual model, §6.2 constructor notation, §6.3 full JSON, §6.4 multi-step probe lowering, §6.5 how the lowering works, §6.6 why Fn+Call is valid, §6.7 no new IR nodes
- **Amendment §7** (Result semantics) — converge results ARE timebox results
- **Amendment §8** (Replay and journaling) — converge journaling IS timebox body journaling; journal traces
- **Amendment §11** (Examples) — polling deployment, waiting for approval, multi-step probe, dynamic interval/timeout
- **Amendment §12** (Deferred/Non-goals) — error retry, backoff, journal compression, why not compound external

The folded content must read as native timebox-spec sections, not as appended amendment text. Remove "This specification amends..." framing. Renumber sections as needed to integrate naturally.

### Into `specs/tisyn-compiler-specification.md` — compiler-specific pieces

- Add `converge` to the authoring table (currently §2.1) as a compiler-recognized form
- **Amendment §9** (Compiler validation and rejection) — recognition rules (§9.1) and the E-CONV-01 through E-CONV-09 / W-CONV-01 rejection table (§9.2), plus free variable validation (§9.3)

### Into `specs/tisyn-authoring-layer-specification.md` — authoring-specific pieces

- **Amendment §4** (Authored syntax) — the `yield* converge({...})` form, config fields table, dynamic interval/timeout guidance, result type
- **Amendment §5** (Authoring constraints AC1–AC7) — probe generator requirement, multi-effect probes, until arrow requirement, until parameter, numeric value expressions, literal object config, free variable capture

### Into `specs/tisyn-constructor-dsl-specification.md` — DSL-specific pieces

- **Amendment §10** (Constructor DSL amendment) — create the macro vocabulary registry as described in §10.1, register `Converge` as its first entry with the expansion defined in §10.2, equivalence requirement (§10.3), vocabulary summary (§10.4)

### After folding

Delete `specs/tisyn-converge-amendment.md`.

---

## Task 3: Update `tisyn-timebox-test-plan.md` references

After renaming (Task 1) and folding (Task 2):

- Replace all references to "Tisyn Converge Compiler and Authoring Amendment 0.1.0" (or similar) with references to the canonical parent specs where the converge content now lives — primarily "Tisyn Timebox Specification" for behavioral content
- Update the `**Tests:**` header line to reference "Tisyn Timebox Specification" (no version) since converge behavioral specs now live in the timebox spec
- Ensure converge test scenarios validate against the canonical timebox spec sections, not a deleted amendment

---

## Task 4: Remove draft/revision/changelog language from ALL specs and test plans

For every `.md` file in `specs/` — both specifications and test plans — normalize so each reads as the current final state.

### Frontmatter normalization

Apply to all spec and test-plan files:

- **Remove** `**Version:**` lines
- **Remove** `**Status:**` lines (`Draft`, `Normative`, `Final Draft`, `Decision-Complete Draft`)
- **Remove** `**Replaces:**` lines (e.g., compound concurrency's "Replaces: 1.3.1-draft")
- **Keep** `**Amends:**`, `**Complements:**`, `**Depends on:**`, `**Tests:**`, and `**Target:**` lines — these express structural relationships
- **Strip version qualifiers** from kept relationship lines (e.g., "Tisyn Timebox Specification 0.1.0" → "Tisyn Timebox Specification")

### Changelog/revision history removal

- `tisyn-compound-concurrency-specification.md`: Delete §17 "Changelog from v1.0.0" entirely — five version entries (v1.3.2 through v1.1.0). All described changes are already incorporated in the spec body.
- `tisyn-constructor-dsl-specification.md`: Delete the "## Changelog" section at the end of the file (currently §, lines 1933–1943).

### Test-plan administrative language cleanup

- Remove "Draft tests gate spec advancement" / "Draft to Ready for approval" process language from test plans where it describes the review/advancement process rather than the test contract itself. Known locations:
  - `tisyn-resource-test-plan.md` lines 105, 484, 562
- Remove version-qualified references to spec versions in test-plan headers and body text
- **Keep** test IDs, fixture schemas, normative test assertions, and tier names (Core, Draft) when they describe test categories — only remove administrative wording about the tier advancement process

---

## Task 5: Update cross-references

After all renames and folding, sweep all files in `specs/` for stale references:

**Old versioned filenames or names:**
- "Compiler Specification 1.2.0" → "Compiler Specification"
- "Timebox Specification v0.1.0" or "Timebox Specification 0.1.0" → "Timebox Specification"
- "System Specification 1.0.0" → "System Specification"
- "Agent Specification 1.1.0" → "Agent Specification"
- All other "Specification X.Y.Z" patterns → "Specification" (versionless)

**Old suffixes and filenames:**
- `-spec.md` references → `-specification.md`
- `tisyn-specification-1.0.md` → `tisyn-system-specification.md`
- `tisyn-compiler-specification-1.1.0.md` → `tisyn-compiler-specification.md`
- `tisyn-agent-specification-1.1.0.md` → `tisyn-agent-specification.md`
- etc. (match the Task 1 rename table)

**Deleted amendment:**
- "Converge Amendment" / "Converge Compiler and Authoring Amendment" → reference the canonical parent spec where the content now lives

**Also check outside `specs/`:**
- `README.md` at repo root for any spec file references
- `.reviewer/` topic files for spec filename references

---

## Execution order

1. Task 1 (renames) — no dependencies
2. Task 2 (amendment folding) — no dependencies
3. Task 3 (test-plan reference updates) — depends on Tasks 1 and 2
4. Task 4 (draft/changelog removal) — can run in parallel with Tasks 1–3
5. Task 5 (cross-reference sweep) — must run last

## Scope boundaries

- `specs/` directory files only — no package source code changes
- No new normative content (no new kernel operations, evaluation sections, etc.)
- No worktree or branch cleanup
- No `.reviewer/AGENTS.md` process section changes (only fix spec filename references in `.reviewer/` topic files if they exist)

---

## Verification

After all tasks complete:

1. `ls specs/` — every file matches `tisyn-<topic>-specification.md`, `tisyn-<topic>-test-plan.md`, or `tisyn-architecture.md`
2. No file named `*-amendment*`, `*-conformance-plan*`, or `*-spec.md` exists
3. No file named with embedded version numbers (`*-1.0*`, `*-1.1.0*`)
4. `grep -rn '^\*\*Version:\*\*\|^\*\*Status:\*\*' specs/` returns no hits (covers specs and test plans)
5. `grep -r 'converge-amendment\|Converge.*[Aa]mendment' specs/` returns no hits
6. `grep -r 'Specification [0-9]\+\.' specs/` returns no version-qualified spec names
7. `grep -r '## Changelog' specs/` returns no hits
8. Converge behavioral content (lowering, result semantics, replay, examples) appears in `specs/tisyn-timebox-specification.md`
9. Converge compiler pieces (recognition, E-CONV-* diagnostics) appear in `specs/tisyn-compiler-specification.md`
10. Converge authoring pieces (syntax, AC1–AC7) appear in `specs/tisyn-authoring-layer-specification.md`
11. Converge DSL pieces (macro registry, `Converge` macro) appear in `specs/tisyn-constructor-dsl-specification.md`
12. `specs/tisyn-timebox-test-plan.md` references the canonical timebox spec for converge scenarios
