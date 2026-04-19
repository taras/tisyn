/**
 * Dependency-direction conformance test.
 *
 * Reads each `packages/<name>/package.json`, extracts the `@tisyn/*` edges
 * from `dependencies` + `peerDependencies` (NOT devDependencies), and checks:
 *
 *   1. Every edge is present in the allowed-edge matrix below.
 *   2. The resulting graph is acyclic.
 *
 * The allowed-edge matrix is a **permit list, not a require list** — an edge
 * in the matrix may or may not exist in the actual graph. What the matrix
 * guarantees is the set of edges that are *allowed to exist*. Forbidden
 * edges (kernel -> agent, effects -> runtime, etc.) are absent from the
 * matrix and will fail the test.
 *
 * This is the #113 refactor guardrail. Post-refactor, @tisyn/effects is the
 * lower shared package for dispatch-boundary mechanics; agent/runtime/transport
 * may depend on it, but nothing lower (ir, kernel, validate, etc.) may.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(moduleDir, "..", "..", "..");
const packagesDir = join(repoRoot, "packages");

/**
 * Allowed `@tisyn/*` edges (dependencies + peerDependencies). Each package
 * maps to the set of workspace packages it is permitted to depend on.
 * Edges not listed here are forbidden.
 */
const ALLOWED_EDGES: Record<string, ReadonlyArray<string>> = {
  agent: ["effects", "ir", "kernel"],
  "claude-code": ["agent", "effects", "ir", "protocol", "transport"],
  cli: [
    "compiler",
    "config",
    "durable-streams",
    "effects",
    "ir",
    "runtime",
    "transport",
  ],
  compiler: ["ir", "validate"],
  config: [],
  conformance: [
    "agent",
    "durable-streams",
    "effects",
    "ir",
    "kernel",
    "runtime",
  ],
  dsl: ["ir"],
  "durable-streams": ["kernel"],
  effects: ["ir", "kernel"],
  ir: [],
  kernel: ["ir", "validate"],
  protocol: ["ir"],
  runtime: [
    "agent",
    "config",
    "durable-streams",
    "effects",
    "ir",
    "kernel",
    "transport",
    "validate",
  ],
  spec: [],
  "spec-workflows": [
    "agent",
    "claude-code",
    "config",
    "ir",
    "spec",
    "transport",
  ],
  transport: [
    "agent",
    "durable-streams",
    "effects",
    "ir",
    "kernel",
    "protocol",
    "runtime",
    "validate",
  ],
  validate: ["ir"],
};

type Edges = Record<string, ReadonlyArray<string>>;

function readWorkspaceGraph(): Edges {
  const graph: Record<string, string[]> = {};
  for (const name of readdirSync(packagesDir)) {
    const pkgJsonPath = join(packagesDir, name, "package.json");
    if (!existsSync(pkgJsonPath)) {
      continue;
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    graph[name] = Object.keys(deps)
      .filter((d) => d.startsWith("@tisyn/"))
      .map((d) => d.slice("@tisyn/".length))
      .sort();
  }
  return graph;
}

/**
 * Pre-existing production-dep cycles accepted as a baseline. Any cycle not
 * listed here fails the test. Represented as canonical sets (order-independent).
 *
 * Known baseline:
 *   - runtime <-> transport: runtime.dependencies includes @tisyn/transport,
 *     and transport.dependencies includes @tisyn/runtime. Pre-#113 condition;
 *     the refactor does not touch this edge.
 */
const KNOWN_CYCLES: ReadonlyArray<ReadonlyArray<string>> = [["runtime", "transport"]];

function findAllCycles(graph: Edges): string[][] {
  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const stack: string[] = [];
  for (const node of Object.keys(graph)) {
    color[node] = WHITE;
  }

  function visit(node: string): void {
    color[node] = GRAY;
    stack.push(node);
    for (const next of graph[node] ?? []) {
      if (color[next] === undefined) {
        continue;
      }
      if (color[next] === GRAY) {
        const start = stack.indexOf(next);
        cycles.push(stack.slice(start).concat(next));
      } else if (color[next] === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color[node] = BLACK;
  }

  for (const node of Object.keys(graph)) {
    if (color[node] === WHITE) {
      visit(node);
    }
  }
  return cycles;
}

function cycleKey(cycle: ReadonlyArray<string>): string {
  // Canonicalize: drop the final repeat, sort members alphabetically.
  const nodes = cycle[0] === cycle[cycle.length - 1] ? cycle.slice(0, -1) : cycle.slice();
  return [...nodes].sort().join(",");
}

function unknownCycles(graph: Edges, known: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  const knownKeys = new Set(known.map((c) => cycleKey(c)));
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const cycle of findAllCycles(graph)) {
    const key = cycleKey(cycle);
    if (knownKeys.has(key)) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cycle);
  }
  return out;
}

function disallowedEdges(graph: Edges, allowed: Edges): string[] {
  const out: string[] = [];
  for (const [from, tos] of Object.entries(graph)) {
    const permitted = new Set(allowed[from] ?? []);
    for (const to of tos) {
      if (!permitted.has(to)) {
        out.push(`${from} -> ${to}`);
      }
    }
  }
  return out;
}

describe("package-graph conformance (dependency direction)", () => {
  const graph = readWorkspaceGraph();

  it("every package appears in the allowed-edge matrix", () => {
    for (const pkg of Object.keys(graph)) {
      expect(ALLOWED_EDGES, `package ${pkg} missing from ALLOWED_EDGES`).toHaveProperty(pkg);
    }
  });

  it("all actual edges are permitted", () => {
    const violations = disallowedEdges(graph, ALLOWED_EDGES);
    expect(violations, `forbidden edges: ${violations.join(", ")}`).toEqual([]);
  });

  it("no new production-dep cycles beyond the baseline", () => {
    const unknown = unknownCycles(graph, KNOWN_CYCLES);
    expect(
      unknown,
      unknown.length ? `unknown cycles: ${unknown.map((c) => c.join(" -> ")).join("; ")}` : "",
    ).toEqual([]);
  });

  // Probe tests — verify the checker actually rejects violations. These are
  // in-memory fixtures; they never mutate real package.json files.
  it("probe: forbidden-edge fixture is rejected", () => {
    const fixture: Edges = {
      ...graph,
      kernel: [...(graph.kernel ?? []), "agent"],
    };
    const violations = disallowedEdges(fixture, ALLOWED_EDGES);
    expect(violations).toContain("kernel -> agent");
  });

  it("probe: cycle fixture is detected", () => {
    const fixture: Edges = {
      a: ["b"],
      b: ["c"],
      c: ["a"],
    };
    const cycles = findAllCycles(fixture);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("probe: unknown cycle is flagged, known cycle is ignored", () => {
    const fixture: Edges = {
      ...graph,
      agent: [...(graph.agent ?? []), "runtime"],
    };
    const unknown = unknownCycles(fixture, KNOWN_CYCLES);
    expect(unknown.length).toBeGreaterThan(0);
  });

  it("probe: effects -> runtime is forbidden", () => {
    const fixture: Edges = {
      ...graph,
      effects: [...(graph.effects ?? []), "runtime"],
    };
    const violations = disallowedEdges(fixture, ALLOWED_EDGES);
    expect(violations).toContain("effects -> runtime");
  });
});
