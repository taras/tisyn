import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { call, type Operation } from "effection";
import { compileGraph, CompileError } from "@tisyn/compiler";
import type { GenerateCommandOptions, ResolvedPass } from "./types.js";
import { ConfigError } from "./config.js";

export function* runGenerate(options: GenerateCommandOptions, cwd: string): Operation<void> {
  const roots = options.roots.map((r) => resolve(cwd, r));

  const result = compileGraph({
    roots,
    validate: options.validate,
    format: options.format,
  });

  if (options.output) {
    const outputPath = resolve(cwd, options.output);
    yield* call(() => mkdir(dirname(outputPath), { recursive: true }));
    yield* call(() => writeFile(outputPath, result.source));
  } else {
    process.stdout.write(result.source);
  }
}

export function* runBuild(
  passes: ResolvedPass[],
  options: { filter?: string; verbose: boolean },
  configDir: string,
): Operation<void> {
  const graph = buildDependencyGraph(passes);
  const ordered = topoSort(
    passes.map((pass) => pass.name),
    graph,
  );
  const selected = selectPasses(ordered, graph, options.filter);
  const passByName = new Map(passes.map((pass) => [pass.name, pass]));

  // Track prior output paths for generated-module detection
  const priorOutputPaths: string[] = [];

  for (const name of ordered) {
    if (!selected.has(name)) {
      continue;
    }

    const pass = passByName.get(name)!;
    const roots = pass.roots.map((r) => resolve(configDir, r));

    const result = compileGraph({
      roots,
      validate: !pass.noValidate,
      format: pass.format,
      generatedModulePaths: priorOutputPaths.length > 0 ? [...priorOutputPaths] : undefined,
    });

    yield* call(() => mkdir(dirname(pass.output), { recursive: true }));
    yield* call(() => writeFile(pass.output, result.source));

    priorOutputPaths.push(pass.output);
  }
}

function buildDependencyGraph(passes: ResolvedPass[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const pass of passes) {
    graph.set(pass.name, new Set(pass.dependsOn));
  }
  return graph;
}

export function topoSort(nodes: string[], graph: Map<string, Set<string>>): string[] {
  const remaining = new Map<string, Set<string>>();
  for (const node of nodes) {
    remaining.set(node, new Set(graph.get(node) ?? []));
  }

  const ordered: string[] = [];
  const ready = nodes.filter((node) => (remaining.get(node)?.size ?? 0) === 0).sort();

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);

    for (const [node, deps] of remaining.entries()) {
      if (!deps.delete(current)) {
        continue;
      }
      if (deps.size === 0 && !ordered.includes(node) && !ready.includes(node)) {
        ready.push(node);
        ready.sort();
      }
    }
  }

  if (ordered.length !== nodes.length) {
    const unresolved = nodes.filter((node) => !ordered.includes(node));
    throw new ConfigError(`Dependency cycle detected: ${unresolved.join(" -> ")}`);
  }

  return ordered;
}

function selectPasses(
  ordered: string[],
  graph: Map<string, Set<string>>,
  filter?: string,
): Set<string> {
  if (!filter) {
    return new Set(ordered);
  }

  if (!ordered.includes(filter)) {
    throw new ConfigError(`Unknown pass '${filter}'`);
  }

  const selected = new Set<string>();
  const visit = (name: string) => {
    if (selected.has(name)) {
      return;
    }
    selected.add(name);
    for (const dep of graph.get(name) ?? []) {
      visit(dep);
    }
  };

  visit(filter);
  return selected;
}

export function formatCompileError(error: unknown): string {
  const ce = error as CompileError & { inputFile?: string };
  if (ce?.code && ce.line !== undefined) {
    const text = ce.message.replace(/^\S+ at \d+:\d+: /, "");
    let out = `error[${ce.code}]: ${text}`;
    const parts = [ce.inputFile, ce.line, ce.column].filter((v) => v != null);
    if (parts.length > 0) {
      out += `\n  --> ${parts.join(":")}`;
    }
    return out;
  }
  return error instanceof Error ? error.message : String(error);
}
