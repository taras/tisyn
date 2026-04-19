#!/usr/bin/env node
// Codemod for Issue #113 — rewrite `@tisyn/agent` imports of moved
// dispatch-boundary symbols to `@tisyn/effects`.
//
// Usage:
//   node scripts/codemod-issue-113.mjs [--check] <file|dir> ...
//
// Moved to `@tisyn/effects` (primary):
//   Effects, dispatch, resolve, invoke,
//   InvalidInvokeCallSiteError, InvalidInvokeInputError,
//   InvalidInvokeOptionError, installCrossBoundaryMiddleware,
//   getCrossBoundaryMiddleware, InvokeOpts, ScopedEffectFrame
// Moved to `@tisyn/effects/internal`:
//   evaluateMiddlewareFn
//
// The codemod is a text transform on ECMAScript `import { ... } from "@tisyn/agent"`
// declarations only; it ignores `require()`, CommonJS, and malformed import
// bodies (e.g. comments inside the brace list).

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const MOVED_TO_EFFECTS = new Set([
  "Effects",
  "dispatch",
  "resolve",
  "invoke",
  "InvalidInvokeCallSiteError",
  "InvalidInvokeInputError",
  "InvalidInvokeOptionError",
  "installCrossBoundaryMiddleware",
  "getCrossBoundaryMiddleware",
  "InvokeOpts",
  "ScopedEffectFrame",
]);

const MOVED_TO_EFFECTS_INTERNAL = new Set(["evaluateMiddlewareFn"]);

const AGENT_IMPORT_RE =
  /^(?<indent>[ \t]*)import\s+(?<typeOnlyDecl>type\s+)?\{(?<body>[^}]*)\}\s+from\s+["']@tisyn\/agent["'];?\s*$/;

function parseSpecs(body, declTypeOnly) {
  const parts = body
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const specs = [];
  for (const part of parts) {
    const m = /^(?:(type)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/.exec(
      part,
    );
    if (!m) {
      return null;
    }
    const [, typeKw, name, alias] = m;
    specs.push({ name, alias, typeOnly: declTypeOnly || Boolean(typeKw) });
  }
  return specs;
}

function formatSpec(s, declTypeOnly) {
  const head = !declTypeOnly && s.typeOnly ? "type " : "";
  return s.alias ? `${head}${s.name} as ${s.alias}` : `${head}${s.name}`;
}

export function rewriteSource(source) {
  const lines = source.split("\n");
  let changed = false;
  const out = [];
  for (const line of lines) {
    const m = AGENT_IMPORT_RE.exec(line);
    if (!m || !m.groups) {
      out.push(line);
      continue;
    }
    const indent = m.groups.indent ?? "";
    const declTypeOnly = Boolean(m.groups.typeOnlyDecl);
    const specs = parseSpecs(m.groups.body ?? "", declTypeOnly);
    if (!specs) {
      out.push(line);
      continue;
    }
    const agentSpecs = [];
    const effectsSpecs = [];
    const internalSpecs = [];
    for (const s of specs) {
      if (MOVED_TO_EFFECTS.has(s.name)) {
        effectsSpecs.push(s);
      } else if (MOVED_TO_EFFECTS_INTERNAL.has(s.name)) {
        internalSpecs.push(s);
      } else {
        agentSpecs.push(s);
      }
    }
    if (effectsSpecs.length === 0 && internalSpecs.length === 0) {
      out.push(line);
      continue;
    }
    changed = true;
    const emit = (pkg, group) => {
      if (group.length === 0) {
        return;
      }
      const allTypeOnly = group.every((s) => s.typeOnly);
      const head = allTypeOnly ? "type " : "";
      const body = group.map((s) => formatSpec(s, allTypeOnly)).join(", ");
      out.push(`${indent}import ${head}{ ${body} } from "${pkg}";`);
    };
    emit("@tisyn/agent", agentSpecs);
    emit("@tisyn/effects", effectsSpecs);
    emit("@tisyn/effects/internal", internalSpecs);
  }
  return { output: out.join("\n"), changed };
}

function walk(path, acc) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
        continue;
      }
      walk(join(path, entry), acc);
    }
    return;
  }
  const ext = extname(path);
  if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") {
    acc.push(path);
  }
}

function main() {
  const args = argv.slice(2);
  const check = args.includes("--check");
  const targets = args.filter((a) => a !== "--check");
  if (targets.length === 0) {
    console.error("usage: node scripts/codemod-issue-113.mjs [--check] <file|dir> ...");
    exit(2);
  }
  const files = [];
  for (const t of targets) {
    walk(resolve(t), files);
  }
  let touched = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const { output, changed } = rewriteSource(src);
    if (!changed) {
      continue;
    }
    touched += 1;
    if (check) {
      console.log(`would rewrite: ${f}`);
    } else {
      writeFileSync(f, output, "utf8");
      console.log(`rewrote: ${f}`);
    }
  }
  console.log(`${check ? "would touch" : "touched"} ${touched} file(s) of ${files.length} scanned`);
}

const selfPath = fileURLToPath(import.meta.url);
const invokedPath = argv[1] ? resolve(argv[1]) : "";
if (invokedPath === selfPath) {
  main();
}
