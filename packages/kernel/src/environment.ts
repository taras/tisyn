/**
 * Environment — linked list of immutable frames.
 *
 * See Kernel Specification §2.
 *
 * Invariants:
 * - Only Val may be stored (I1)
 * - Immutable — no mutation operation (I2)
 * - Never crosses process boundaries (I3)
 * - Inner bindings shadow outer (I4)
 */

import type { Val } from "@tisyn/ir";
import { UnboundVariable, ArityMismatch } from "./errors.js";

export interface Env {
  readonly frame: ReadonlyMap<string, Val>;
  readonly parent: Env | null;
}

/** The empty environment. */
export const EMPTY_ENV: Env = { frame: new Map(), parent: null };

/**
 * Look up a name in the environment.
 * Walks the frame chain from innermost to outermost.
 * Raises UnboundVariable if not found.
 */
export function lookup(name: string, env: Env): Val {
  let current: Env | null = env;
  while (current !== null) {
    if (current.frame.has(name)) {
      return current.frame.get(name)!;
    }
    current = current.parent;
  }
  throw new UnboundVariable(name);
}

/** Extend the environment with a single binding. */
export function extend(env: Env, name: string, val: Val): Env {
  const frame = new Map<string, Val>();
  frame.set(name, val);
  return { frame, parent: env };
}

/** Extend the environment with multiple bindings. */
export function extendMulti(env: Env, names: string[], vals: Val[]): Env {
  if (names.length !== vals.length) {
    throw new ArityMismatch(names.length, vals.length);
  }
  const frame = new Map<string, Val>();
  for (let i = 0; i < names.length; i++) {
    frame.set(names[i]!, vals[i]!);
  }
  return { frame, parent: env };
}

/**
 * Create an environment from a plain object.
 * Used for initial environment from test fixtures.
 */
export function envFromRecord(record: Record<string, Val>): Env {
  const frame = new Map<string, Val>(Object.entries(record));
  return { frame, parent: null };
}
