// Corpus acquisition per §7 of specs/tisyn-spec-system-specification.md.
//
// Acquisition is the sole effectful boundary between the corpus and the
// workflow (§7.1, §7.4). It is all-or-nothing: a partial registry is never
// returned (§7.5). Three failure kinds surface as AcquisitionError:
//
//   F1 — normalization failure (SS-AQ-010, SS-AQ-011)
//   F2 — source unavailable   (SS-AQ-012)
//   F3 — duplicate id         (SS-AQ-013)
//
// Operation<T> bodies `yield` Promise values. Consuming runtimes (effection
// under `tsn run`, `@effectionx/vitest`'s `run` in tests) resolve them.
//
// §7.7 auxiliary deviation. The §7.7 auxiliary operations `acquireFixture`
// and `acquireEmittedMarkdown` live on the `AcquireAPI` returned by
// `createAcquire` but are NOT exported as default-bound module-level
// operations. Default readers that read `corpus/*/__fixtures__/*.md` and
// repo-root `specs/*.md` cannot be honest for published consumers: the
// tarball ships `dist/` only and there is no repo root in an install
// context. Callers (incl. `@tisyn/spec-workflows`) construct a pre-bound
// API via `createAcquire({ manifest, readFixture, readEmitted })` with
// readers that know their own deployment layout. This is a deliberate,
// scoped deviation from §7.7; the §7.7 operation shapes are preserved.

import { manifest as defaultManifest, type ManifestEntry } from "./manifest.ts";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import { buildRegistry } from "./registry.ts";
import {
  AcquisitionError,
  type AcquisitionFailureEntry,
  type AcquisitionScope,
  type CorpusRegistry,
  type NormalizedSpecModule,
  type NormalizedTestPlanModule,
  type Operation,
  type Scope,
  type SpecModule,
  type TestPlanModule,
} from "./types.ts";

// Effection-compatible promise awaiter. Yields an instruction object with the
// shape the effection reducer understands: { description, enter } where enter
// receives a `settle` callback taking { ok: true, value } or
// { ok: false, error }. Keeping this local avoids a direct dependency on
// effection (§1.2) while allowing the yielded Operation<T> to drive cleanly
// under `tsn run` and `@effectionx/vitest`.
function* awaitPromise<T>(promise: Promise<T>): Operation<T> {
  const instruction = {
    description: "awaitPromise",
    enter: (settle: (result: { ok: true; value: T } | { ok: false; error: Error }) => void) => {
      promise.then(
        (value) => settle({ ok: true, value }),
        (error: unknown) =>
          settle({
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
      return (discarded: (result: { ok: true }) => void) => discarded({ ok: true });
    },
  };
  return (yield instruction) as T;
}

export interface AcquireOptions {
  readonly manifest: readonly ManifestEntry[];
  readonly readFixture?: (id: string, kind: "spec" | "plan") => Operation<string>;
  readonly readEmitted?: (id: string, kind: "spec" | "plan") => Operation<string>;
}

export interface AcquireAPI {
  readonly acquireCorpusRegistry: (scope?: AcquisitionScope) => Operation<CorpusRegistry>;
  readonly acquireFixture: (id: string, kind: "spec" | "plan") => Operation<string>;
  readonly acquireEmittedMarkdown: (id: string, kind: "spec" | "plan") => Operation<string>;
}

export function createAcquire(opts: AcquireOptions): AcquireAPI {
  const entries = opts.manifest;
  const readFixture = opts.readFixture;
  const readEmitted = opts.readEmitted;

  function* acquireCorpusRegistryImpl(scope?: AcquisitionScope): Operation<CorpusRegistry> {
    // Decide which manifest entries to load. Unknown requested ids are
    // ignored — unresolved targets are not an acquisition failure (§7.4 A6).
    const filtered = scope?.specIds !== undefined;
    const requestedIds = filtered ? new Set(scope!.specIds) : undefined;
    const chosen = filtered ? entries.filter((e) => requestedIds!.has(e.id)) : entries;

    // F2 — load phase. Collect every Promise rejection into one aggregate.
    type Loaded = { id: string; spec: SpecModule; plan?: TestPlanModule };
    const loaded: Loaded[] = [];
    const loadFailures: AcquisitionFailureEntry[] = [];
    for (const entry of chosen) {
      let spec: SpecModule | undefined;
      try {
        spec = yield* awaitPromise(entry.loadSpec());
      } catch (err) {
        loadFailures.push({ id: entry.id, reason: errorMessage(err) });
        continue;
      }
      let plan: TestPlanModule | undefined;
      if (entry.loadPlan !== undefined) {
        try {
          plan = yield* awaitPromise(entry.loadPlan());
        } catch (err) {
          loadFailures.push({ id: entry.id, reason: errorMessage(err) });
          continue;
        }
      }
      loaded.push({ id: entry.id, spec, ...(plan !== undefined ? { plan } : {}) });
    }
    if (loadFailures.length > 0) {
      throw new AcquisitionError(
        "F2",
        `Source unavailable for ${loadFailures.length} module(s)`,
        loadFailures,
      );
    }

    // F1 — normalization phase. Every module must normalize, else aggregate.
    // Track manifest entry id alongside each normalized module so F3 below
    // can name both colliding origins per §8.4 ("MUST identify both modules").
    type NormalizedSpecEntry = {
      readonly entryId: string;
      readonly module: NormalizedSpecModule;
    };
    type NormalizedPlanEntry = {
      readonly entryId: string;
      readonly module: NormalizedTestPlanModule;
    };
    const normalizedSpecs: NormalizedSpecEntry[] = [];
    const normalizedPlans: NormalizedPlanEntry[] = [];
    const normFailures: AcquisitionFailureEntry[] = [];
    for (const item of loaded) {
      const specResult = normalizeSpec(item.spec);
      if (specResult.status === "error") {
        normFailures.push({ id: item.id, reason: formatNormErrors(specResult.errors) });
        continue;
      }
      normalizedSpecs.push({ entryId: item.id, module: specResult.value });
      if (item.plan !== undefined) {
        const planResult = normalizeTestPlan(item.plan);
        if (planResult.status === "error") {
          normFailures.push({
            id: `${item.id} (plan)`,
            reason: formatNormErrors(planResult.errors),
          });
          continue;
        }
        normalizedPlans.push({ entryId: item.id, module: planResult.value });
      }
    }
    if (normFailures.length > 0) {
      throw new AcquisitionError(
        "F1",
        `Normalization failed for ${normFailures.length} module(s)`,
        normFailures,
      );
    }

    // F3 — duplicate id across the whole corpus (D2, D18). Unified pass over
    // spec and plan id spaces: the moment a second module claims an
    // already-seen id, throw with both origins in `modules`.
    type SeenEntry = {
      readonly entryId: string;
      readonly kind: "spec" | "test-plan";
    };
    const seen = new Map<string, SeenEntry>();
    for (const e of normalizedSpecs) {
      const prior = seen.get(e.module.id);
      if (prior !== undefined) {
        throw new AcquisitionError(
          "F3",
          `Duplicate id "${e.module.id}" — ${prior.kind} from manifest entry "${prior.entryId}" collides with spec from manifest entry "${e.entryId}"`,
          [
            { id: e.module.id, reason: `${prior.kind} from manifest entry "${prior.entryId}"` },
            { id: e.module.id, reason: `spec from manifest entry "${e.entryId}"` },
          ],
        );
      }
      seen.set(e.module.id, { entryId: e.entryId, kind: "spec" });
    }
    for (const e of normalizedPlans) {
      const prior = seen.get(e.module.id);
      if (prior !== undefined) {
        throw new AcquisitionError(
          "F3",
          `Duplicate id "${e.module.id}" — ${prior.kind} from manifest entry "${prior.entryId}" collides with test-plan from manifest entry "${e.entryId}"`,
          [
            { id: e.module.id, reason: `${prior.kind} from manifest entry "${prior.entryId}"` },
            { id: e.module.id, reason: `test-plan from manifest entry "${e.entryId}"` },
          ],
        );
      }
      seen.set(e.module.id, { entryId: e.entryId, kind: "test-plan" });
    }

    // Hand off to buildRegistry. F3 is already decided above; buildRegistry's
    // own duplicate-id guard is defense-in-depth for direct callers and
    // should never fire on this path.
    const all = [...normalizedSpecs.map((e) => e.module), ...normalizedPlans.map((e) => e.module)];
    const buildScope: Scope = filtered
      ? { kind: "filtered", specIds: [...scope!.specIds!] }
      : { kind: "full" };
    return buildRegistry(all, buildScope);
  }

  function* acquireFixtureImpl(id: string, kind: "spec" | "plan"): Operation<string> {
    if (readFixture === undefined) {
      throw new TypeError(
        "createAcquire: acquireFixture called without a readFixture reader — " +
          "supply one via createAcquire({ manifest, readFixture }).",
      );
    }
    return (yield* readFixture(id, kind)) as string;
  }

  function* acquireEmittedMarkdownImpl(id: string, kind: "spec" | "plan"): Operation<string> {
    if (readEmitted === undefined) {
      throw new TypeError(
        "createAcquire: acquireEmittedMarkdown called without a readEmitted reader — " +
          "supply one via createAcquire({ manifest, readEmitted }).",
      );
    }
    return (yield* readEmitted(id, kind)) as string;
  }

  return {
    acquireCorpusRegistry: acquireCorpusRegistryImpl,
    acquireFixture: acquireFixtureImpl,
    acquireEmittedMarkdown: acquireEmittedMarkdownImpl,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function formatNormErrors(
  errors: readonly { constraint: string; message: string; path?: readonly (string | number)[] }[],
): string {
  return errors
    .map((e) => {
      const p = e.path && e.path.length > 0 ? ` @ ${e.path.join(".")}` : "";
      return `[${e.constraint}] ${e.message}${p}`;
    })
    .join("; ");
}

// Only `acquireCorpusRegistry` is bound at module level — it reads only
// compiled corpus TS modules shipped under `dist/corpus/`, which is honest
// for published consumers. Fixture/emitted readers are constructed by
// callers with their own readers (see `@tisyn/spec-workflows/src/acquire.ts`).
const defaultApi = createAcquire({ manifest: defaultManifest });

export const acquireCorpusRegistry = defaultApi.acquireCorpusRegistry;
