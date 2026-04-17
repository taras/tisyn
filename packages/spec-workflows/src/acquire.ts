// Monorepo-only pre-bound `AcquireAPI` with fixture/emitted readers.
//
// `@tisyn/spec` removed its default-bound `acquireFixture` /
// `acquireEmittedMarkdown` exports (deliberate deviation from §7.7):
// those defaults were reading `<packageRoot>/corpus/.../__fixtures__/*.md`
// and `<repoRoot>/specs/*.md`, neither of which is shipped in the
// published tarball. Consumers that need the auxiliary operations must
// supply their own readers.
//
// `@tisyn/spec-workflows` is monorepo-only (`"private": true`) and knows
// its deployment layout: `packages/spec-workflows/` is a sibling of
// `packages/spec/`, and the human-authored emitted markdown lives at
// `<repoRoot>/specs/`. This file constructs a pre-bound `AcquireAPI`
// with readers that resolve those paths and exports the two auxiliary
// operations for the rest of spec-workflows to use.
//
// Locating @tisyn/spec's package root from a sibling package requires
// Node's module-resolution algorithm, not a parent walk. We ask Node
// to resolve `@tisyn/spec/package.json` (which @tisyn/spec exposes via
// its `exports` map) and take its directory. Works for both workspace
// symlinks and real installs.

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { call } from "effection";
import {
  createAcquire,
  manifest,
  type AcquireAPI,
  type Operation,
} from "@tisyn/spec";

const require_ = createRequire(import.meta.url);

const SPEC_PACKAGE_JSON = require_.resolve("@tisyn/spec/package.json");
const SPEC_PACKAGE_ROOT = dirname(SPEC_PACKAGE_JSON);

// Monorepo layout assumption: `packages/spec/` under the repo root.
// Repo root is two levels above the spec package root.
const REPO_ROOT = resolve(SPEC_PACKAGE_ROOT, "..", "..");

function* readFixture(id: string, kind: "spec" | "plan"): Operation<string> {
  const filename = kind === "spec" ? "original-spec.md" : "original-test-plan.md";
  const path = resolve(SPEC_PACKAGE_ROOT, "corpus", id, "__fixtures__", filename);
  return (yield* call(() => readFile(path, "utf8"))) as string;
}

function* readEmitted(id: string, kind: "spec" | "plan"): Operation<string> {
  const suffix = kind === "spec" ? "spec.md" : "test-plan.md";
  const path = resolve(REPO_ROOT, "specs", `${id}-${suffix}`);
  return (yield* call(() => readFile(path, "utf8"))) as string;
}

const api: AcquireAPI = createAcquire({ manifest, readFixture, readEmitted });

export const acquireFixture = api.acquireFixture;
export const acquireEmittedMarkdown = api.acquireEmittedMarkdown;
