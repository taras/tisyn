import type { EnvDescriptor } from "./types.js";

export interface ConfigVisitor {
  (node: Record<string, unknown>, path: string): void;
}

/**
 * Depth-first traversal of all nodes with a `tisyn_config` field.
 */
export function walkConfig(descriptor: unknown, visitor: ConfigVisitor): void {
  walkValue(descriptor, "", visitor);
}

function walkValue(value: unknown, path: string, visitor: ConfigVisitor): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkValue(value[i], path === "" ? `[${i}]` : `${path}[${i}]`, visitor);
    }
    return;
  }

  const obj = value as Record<string, unknown>;

  if ("tisyn_config" in obj) {
    visitor(obj, path);
  }

  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (child !== null && typeof child === "object") {
      walkValue(child, path === "" ? key : `${path}.${key}`, visitor);
    }
  }
}

/**
 * Collect all EnvDescriptor nodes from a descriptor tree.
 */
export function collectEnvNodes(descriptor: unknown): EnvDescriptor[] {
  const nodes: EnvDescriptor[] = [];
  walkConfig(descriptor, (node) => {
    if (node.tisyn_config === "env") {
      nodes.push(node as unknown as EnvDescriptor);
    }
  });
  return nodes;
}
