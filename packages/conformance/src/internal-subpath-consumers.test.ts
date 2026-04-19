/**
 * Internal-subpath consumer-discipline scan.
 *
 * `@tisyn/effects/internal` is a non-stable workspace seam. Only a small set
 * of workspace packages (the ones that implement the reference dispatch
 * boundary) may import from it. Any other importer — user code, a new
 * workspace package, or a mistakenly wired test — is a discipline violation.
 *
 * This scan walks every `.ts` / `.tsx` file under `packages/*\/src/` and
 * `examples/`, extracts `import ... from '@tisyn/effects/internal'` specifiers
 * (bare or with trailing segments), and asserts the importing file lives
 * under one of the allowed packages.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const moduleFile = fileURLToPath(import.meta.url);
const moduleDir = dirname(moduleFile);
const repoRoot = join(moduleDir, "..", "..", "..");
const packagesDir = join(repoRoot, "packages");
const examplesDir = join(repoRoot, "examples");

// This file contains the regex and thus also mentions the import specifier
// in its own comments and doc. Exclude it from the scan to avoid false
// positives on the scanner's own source.
const SELF_BASENAME = "internal-subpath-consumers.test.ts";

const ALLOWED_PACKAGES = new Set(["effects", "agent", "runtime", "transport"]);

const IMPORT_RE = /\bfrom\s+["']@tisyn\/effects\/internal(?:\/[^"']*)?["']/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) {
      if (name === SELF_BASENAME) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

function packageOf(file: string): string | null {
  const rel = relative(packagesDir, file);
  if (rel.startsWith("..")) {
    return null;
  }
  const [pkg] = rel.split(sep);
  return pkg ?? null;
}

function scanImports(files: string[]): Array<{ file: string; specifier: string }> {
  const hits: Array<{ file: string; specifier: string }> = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(IMPORT_RE)) {
      hits.push({ file, specifier: match[0] });
    }
  }
  return hits;
}

describe("internal-subpath consumer discipline", () => {
  const allFiles = [...walk(packagesDir), ...walk(examplesDir)];

  it("every @tisyn/effects/internal import originates in an allowed package", () => {
    const violations: string[] = [];
    for (const hit of scanImports(allFiles)) {
      const pkg = packageOf(hit.file);
      const from = pkg ?? `(outside packages/) ${relative(repoRoot, hit.file)}`;
      if (!pkg || !ALLOWED_PACKAGES.has(pkg)) {
        violations.push(`${from}: ${hit.specifier.trim()}`);
      }
    }
    expect(violations, `disallowed imports:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("probe: import from an outside package is rejected by packageOf+ALLOWED_PACKAGES", () => {
    // Simulate an @tisyn/effects/internal import originating in packages/ir —
    // the rule must reject this regardless of whether any such import exists
    // in the actual repo.
    const fakeFile = join(packagesDir, "ir", "src", "fake-violation.ts");
    const pkg = packageOf(fakeFile);
    expect(pkg).toBe("ir");
    expect(ALLOWED_PACKAGES.has(pkg ?? "")).toBe(false);
  });

  it("probe: import from an allowed package is accepted", () => {
    const fakeFile = join(packagesDir, "runtime", "src", "fake-consumer.ts");
    const pkg = packageOf(fakeFile);
    expect(pkg).toBe("runtime");
    expect(ALLOWED_PACKAGES.has(pkg ?? "")).toBe(true);
  });

  it("probe: the import regex matches the expected shapes", () => {
    // Build sample strings via concatenation so this file does not itself
    // match IMPORT_RE when the test walks the repo tree.
    const base = "@tisyn" + "/effects" + "/internal";
    const samples = [
      `import { DispatchContext } FROM "${base}";`.replace("FROM", "from"),
      `import type { DispatchContextT } FROM '${base}';`.replace("FROM", "from"),
      `import { x } FROM "${base}/nested";`.replace("FROM", "from"),
    ];
    for (const s of samples) {
      expect(s.match(IMPORT_RE), s).not.toBeNull();
    }
    // Negatives — primary barrel imports must not match.
    const primary = `import { invoke } FROM "@tisyn/effects";`.replace("FROM", "from");
    expect(primary.match(IMPORT_RE)).toBeNull();
  });
});
