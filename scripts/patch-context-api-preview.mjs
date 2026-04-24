#!/usr/bin/env node
/**
 * Post-install workaround for @effectionx/context-api PR #215 preview
 * (0.7.0 via pkg.pr.new).
 *
 * The preview ships mod.ts and exposes it via an
 * `exports["."]["development"]` condition. When this workspace's
 * Vitest + tsx setup spawns a real Node worker thread (packages/
 * transport worker tests), the worker inherits tsx's `"development"`
 * condition and Node tries to load mod.ts from inside node_modules,
 * which fails (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
 *
 * Strip the `development` condition from the installed package
 * manifest so Node falls through to `import` and loads dist/mod.js
 * inside worker threads.
 *
 * pnpm's `readPackage` hook does not rewrite the on-disk manifest
 * when a dependency is installed from a pkg.pr.new URL (verified on
 * pnpm 9.15.9), so this runs as a workspace `prepare` / `pretest`
 * step that touches the materialized package.json directly.
 *
 * Remove this workaround (and this script) once:
 *   - PR #215 (thefrontside/effectionx) merges and releases a real
 *     version without the `development` source-TS condition, AND
 *   - all workspace package.json pins are updated to that version.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(here, "..");
const pnpmRoot = join(workspaceRoot, "node_modules", ".pnpm");

let entries;
try {
  entries = readdirSync(pnpmRoot);
} catch {
  // node_modules/.pnpm is absent (pre-install). Nothing to do.
  process.exit(0);
}

const targets = entries.filter((name) => name.startsWith("@effectionx+context-api@"));

let patched = 0;
for (const dirName of targets) {
  const manifestPath = join(
    pnpmRoot,
    dirName,
    "node_modules",
    "@effectionx",
    "context-api",
    "package.json",
  );

  let manifestText;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch {
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    continue;
  }

  const dot = manifest.exports && manifest.exports["."];
  if (!dot || typeof dot !== "object" || !("development" in dot)) {
    continue;
  }

  delete dot.development;

  const stat = statSync(manifestPath);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // Preserve timestamps so pnpm's reproducibility checks don't trip.
  const { atime, mtime } = stat;
  try {
    // Node's utimesSync is available on all platforms.
    const { utimesSync } = await import("node:fs");
    utimesSync(manifestPath, atime, mtime);
  } catch {
    // best-effort
  }
  patched++;
}

if (patched > 0) {
  console.log(
    `[patch-context-api-preview] stripped "development" exports condition from ${patched} install(s)`,
  );
}
