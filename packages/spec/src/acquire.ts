// Corpus acquisition per §7 of tisyn-spec-system-specification.source.md.
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
// under `tsn run`, `@effectionx/vitest`'s `run` in tests) resolve them. The
// `createAcquire` factory is the DI seam that tests use with in-memory
// manifests and custom filesystem readers.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// Default filesystem readers. Auxiliary acquisition (§7.7) reads raw
// Markdown — fixtures from `packages/spec/corpus/<id>/__fixtures__/` and
// emitted Markdown from repo-root `specs/`. These paths are implementation
// choices, not part of the spec surface.
//
// Locating the package root via `resolve(HERE, "..", ...)` is fragile
// because `HERE` differs between the source tree (`src/`) and the compiled
// output (`dist/src/`). Instead, walk up the directory tree until the
// `@tisyn/spec` package.json is found; that is the unambiguous anchor for
// both the in-package `corpus/` directory and the repo-root `specs/`
// directory. Resolution is async and memoized — no sync filesystem IO.
const HERE = dirname(fileURLToPath(import.meta.url));

let packageRootPromise: Promise<string> | undefined;

function resolvePackageRoot(): Promise<string> {
  if (packageRootPromise === undefined) {
    packageRootPromise = (async () => {
      let dir = HERE;
      while (true) {
        try {
          const pkgText = await readFile(resolve(dir, "package.json"), "utf8");
          const pkg = JSON.parse(pkgText) as { name?: string };
          if (pkg.name === "@tisyn/spec") return dir;
        } catch {
          // no readable package.json here, keep walking
        }
        const parent = dirname(dir);
        if (parent === dir) {
          throw new Error(
            `Unable to locate @tisyn/spec package root starting from ${HERE}`,
          );
        }
        dir = parent;
      }
    })();
  }
  return packageRootPromise;
}

// Effection-compatible promise awaiter. Yields an instruction object with the
// shape the effection reducer understands: { description, enter } where enter
// receives a `settle` callback taking { ok: true, value } or
// { ok: false, error }. Keeping this local avoids a direct dependency on
// effection while allowing the yielded Operation<T> to drive cleanly under
// `tsn run` and `@effectionx/vitest`.
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

function* defaultReadFixture(id: string, kind: "spec" | "plan"): Operation<string> {
  const filename = kind === "spec" ? "original-spec.md" : "original-test-plan.md";
  const packageRoot = yield* awaitPromise(resolvePackageRoot());
  const path = resolve(packageRoot, "corpus", id, "__fixtures__", filename);
  return yield* awaitPromise(readFile(path, "utf8"));
}

function* defaultReadEmitted(id: string, kind: "spec" | "plan"): Operation<string> {
  const suffix = kind === "spec" ? "spec.md" : "test-plan.md";
  const packageRoot = yield* awaitPromise(resolvePackageRoot());
  const repoRoot = resolve(packageRoot, "..", "..");
  const path = resolve(repoRoot, "specs", `${id}-${suffix}`);
  return yield* awaitPromise(readFile(path, "utf8"));
}

interface AcquireOptions {
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
  const readFixture = opts.readFixture ?? defaultReadFixture;
  const readEmitted = opts.readEmitted ?? defaultReadEmitted;

  function* acquireCorpusRegistryImpl(
    scope?: AcquisitionScope,
  ): Operation<CorpusRegistry> {
    // Decide which manifest entries to load. Unknown requested ids are
    // ignored — unresolved targets are not an acquisition failure (§7.4 A6).
    const filtered = scope?.specIds !== undefined;
    const requestedIds = filtered ? new Set(scope!.specIds) : undefined;
    const chosen = filtered
      ? entries.filter((e) => requestedIds!.has(e.id))
      : entries;

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
    const normalizedSpecs: NormalizedSpecModule[] = [];
    const normalizedPlans: NormalizedTestPlanModule[] = [];
    const normFailures: AcquisitionFailureEntry[] = [];
    for (const item of loaded) {
      const specResult = normalizeSpec(item.spec);
      if (specResult.status === "error") {
        normFailures.push({ id: item.id, reason: formatNormErrors(specResult.errors) });
        continue;
      }
      normalizedSpecs.push(specResult.value);
      if (item.plan !== undefined) {
        const planResult = normalizeTestPlan(item.plan);
        if (planResult.status === "error") {
          normFailures.push({
            id: `${item.id} (plan)`,
            reason: formatNormErrors(planResult.errors),
          });
          continue;
        }
        normalizedPlans.push(planResult.value);
      }
    }
    if (normFailures.length > 0) {
      throw new AcquisitionError(
        "F1",
        `Normalization failed for ${normFailures.length} module(s)`,
        normFailures,
      );
    }

    // F3 — duplicate id. buildRegistry throws; map to AcquisitionError.
    const all = [...normalizedSpecs, ...normalizedPlans];
    const buildScope: Scope = filtered
      ? { kind: "filtered", specIds: [...scope!.specIds!] }
      : { kind: "full" };
    try {
      return buildRegistry(all, buildScope);
    } catch (err) {
      const message = errorMessage(err);
      // buildRegistry phrases duplicate-id errors with the offending id in
      // quotes; parse it out when present, else surface the raw message.
      const match = /"([^"]+)"/.exec(message);
      const offending: AcquisitionFailureEntry[] = match
        ? [{ id: match[1]!, reason: message }]
        : [{ id: "<unknown>", reason: message }];
      throw new AcquisitionError("F3", message, offending);
    }
  }

  function* acquireFixtureImpl(id: string, kind: "spec" | "plan"): Operation<string> {
    return (yield* readFixture(id, kind)) as string;
  }

  function* acquireEmittedMarkdownImpl(
    id: string,
    kind: "spec" | "plan",
  ): Operation<string> {
    return (yield* readEmitted(id, kind)) as string;
  }

  return {
    acquireCorpusRegistry: acquireCorpusRegistryImpl,
    acquireFixture: acquireFixtureImpl,
    acquireEmittedMarkdown: acquireEmittedMarkdownImpl,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
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

// Default instance bound to the repo manifest + filesystem readers. Workflow
// code imports these directly; tests use `createAcquire` with in-memory
// loaders.
const defaultApi = createAcquire({ manifest: defaultManifest });

export const acquireCorpusRegistry = defaultApi.acquireCorpusRegistry;
export const acquireFixture = defaultApi.acquireFixture;
export const acquireEmittedMarkdown = defaultApi.acquireEmittedMarkdown;
