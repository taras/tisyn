import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { call, type Operation } from "effection";
import ts from "typescript";
import {
  generateWorkflowModule,
  CompileError,
  type GenerateResult,
  type DiscoveredContract,
} from "@tisyn/compiler";
import type { GenerateCommandOptions, ResolvedPass } from "./types.js";
import { ConfigError } from "./config.js";

export function* runGenerate(options: GenerateCommandOptions, cwd: string): Operation<void> {
  const inputPath = resolve(cwd, options.input);
  const includePaths = yield* call(() => expandPatterns(options.include, cwd));
  const assembled = yield* call(() =>
    assembleSource({
      inputPath,
      workflowPaths: includePaths,
      stubBlocks: [],
      stripImportsFrom: new Set(),
    }),
  );

  const inputRelPath = relative(cwd, inputPath) || inputPath;
  const filename = options.output
    ? relative(cwd, resolve(cwd, options.output)) || options.output
    : inputRelPath;

  let result: GenerateResult;
  try {
    result = generateWorkflowModule(assembled.source, {
      filename,
      validate: options.validate,
      workflowFormat: options.format,
    });
  } catch (err) {
    if (err instanceof CompileError) {
      (err as CompileError & { inputFile: string }).inputFile = filename;
    }
    throw err;
  }

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
  const sourcesByPass = new Map<string, string[]>();
  const results = new Map<string, GenerateResult>();
  const outputsToPass = new Map<string, string>();

  for (const pass of passes) {
    outputsToPass.set(pass.output, pass.name);
    const workflowPaths = yield* call(() => expandPatterns(pass.include, configDir));
    sourcesByPass.set(pass.name, [pass.input, ...workflowPaths]);
  }

  const graph = yield* call(() => inferDependencyGraph(passes, sourcesByPass, outputsToPass));
  const ordered = topoSort(
    passes.map((pass) => pass.name),
    graph,
  );
  const selected = selectPasses(ordered, graph, options.filter);
  const passByName = new Map(passes.map((pass) => [pass.name, pass]));

  for (const name of ordered) {
    if (!selected.has(name)) {
      continue;
    }

    const pass = passByName.get(name)!;
    const deps = [...(graph.get(name) ?? [])]
      .map((depName) => results.get(depName))
      .filter(Boolean) as GenerateResult[];
    const stripImportsFrom = new Set(
      [...(graph.get(name) ?? [])].map((depName) => passByName.get(depName)!.output),
    );
    const workflowPaths = sourcesByPass.get(name)!.filter((path) => path !== pass.input);
    const assembled = yield* call(() =>
      assembleSource({
        inputPath: pass.input,
        workflowPaths,
        stubBlocks: deps.map(createStubBlock),
        stripImportsFrom,
      }),
    );

    const filename = relative(configDir, pass.output) || pass.output;
    let result: GenerateResult;
    try {
      result = generateWorkflowModule(assembled.source, {
        filename,
        validate: !pass.noValidate,
        workflowFormat: pass.format,
      });
    } catch (err) {
      if (err instanceof CompileError) {
        (err as CompileError & { inputFile: string }).inputFile = filename;
      }
      throw err;
    }
    results.set(name, result);

    yield* call(() => mkdir(dirname(pass.output), { recursive: true }));
    yield* call(() => writeFile(pass.output, result.source));
  }
}

async function inferDependencyGraph(
  passes: ResolvedPass[],
  sourcesByPass: Map<string, string[]>,
  outputsToPass: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const graph = new Map<string, Set<string>>();

  for (const pass of passes) {
    graph.set(pass.name, new Set(pass.dependsOn));
  }

  for (const pass of passes) {
    const deps = graph.get(pass.name)!;
    for (const sourcePath of sourcesByPass.get(pass.name) ?? []) {
      const source = await readFile(sourcePath, "utf-8");
      const sourceFile = ts.createSourceFile(
        sourcePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        sourcePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
      );
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) {
          continue;
        }
        const raw = statement.moduleSpecifier.getText(sourceFile).slice(1, -1);
        if (!raw.startsWith("./") && !raw.startsWith("../")) {
          continue;
        }

        const resolvedImport = resolveImportPath(raw, dirname(sourcePath));
        const dep = outputsToPass.get(resolvedImport);
        if (dep && dep !== pass.name) {
          deps.add(dep);
        }
      }
    }
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

async function assembleSource(input: {
  inputPath: string;
  workflowPaths: string[];
  stubBlocks: string[];
  stripImportsFrom: Set<string>;
}): Promise<{ source: string }> {
  const declarationSource = await readFile(input.inputPath, "utf-8");
  const workflowSources = await Promise.all(
    input.workflowPaths.map(async (path) =>
      stripImportsFromSource(await readFile(path, "utf-8"), path, input.stripImportsFrom),
    ),
  );

  const parts = [declarationSource];
  if (input.stubBlocks.length > 0) {
    parts.push(input.stubBlocks.filter(Boolean).join("\n"));
  }
  parts.push(...workflowSources.filter(Boolean));

  return { source: parts.filter(Boolean).join("\n\n") };
}

async function expandPatterns(patterns: string[], cwd: string): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for await (const match of glob(pattern, { cwd })) {
      const path = resolve(cwd, match);
      files.add(path);
    }
  }
  return [...files].sort();
}

function createStubBlock(result: GenerateResult): string {
  const workflowStubs = Object.keys(result.workflows)
    .sort()
    .map((name) => `declare const ${name}: unknown;`);
  const contractStubs = result.contracts.map(
    (contract: DiscoveredContract) => `declare function ${contract.name}(): unknown;`,
  );
  return [...contractStubs, ...workflowStubs].join("\n");
}

function stripImportsFromSource(
  source: string,
  sourcePath: string,
  stripImportsFrom: Set<string>,
): string {
  if (stripImportsFrom.size === 0) {
    return source;
  }

  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const removals: Array<{ start: number; end: number }> = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const raw = statement.moduleSpecifier.getText(sourceFile).slice(1, -1);
    if (!raw.startsWith("./") && !raw.startsWith("../")) {
      continue;
    }
    const resolvedImport = resolveImportPath(raw, dirname(sourcePath));
    if (stripImportsFrom.has(resolvedImport)) {
      removals.push({ start: statement.getFullStart(), end: statement.getEnd() });
    }
  }

  if (removals.length === 0) {
    return source;
  }

  let cursor = 0;
  let result = "";
  for (const removal of removals) {
    result += source.slice(cursor, removal.start);
    cursor = removal.end;
  }
  result += source.slice(cursor);
  return result.trim();
}

function resolveImportPath(specifier: string, fromDir: string): string {
  const resolved = resolve(fromDir, specifier);
  if (extname(resolved)) {
    return resolved;
  }
  return `${resolved}.ts`;
}

export function formatCompileError(error: unknown): string {
  const ce = error as CompileError & { inputFile?: string };
  if (ce?.code && ce.line !== undefined) {
    const text = ce.message.replace(/^\S+ at \d+:\d+: /, "");
    let out = `error[${ce.code}]: ${text}`;
    const parts = [ce.inputFile, ce.line, ce.column].filter((v) => v != null);
    if (parts.length > 0) out += `\n  --> ${parts.join(":")}`;
    return out;
  }
  return error instanceof Error ? error.message : String(error);
}
