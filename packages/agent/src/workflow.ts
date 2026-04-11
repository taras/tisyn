import type { Workflow } from "./types.js";

/**
 * Declare a resource with lifecycle management.
 *
 * Compiler-recognized form — `tsn generate` replaces `yield* resource(...)`
 * with IR. Throws if called at runtime without compilation.
 */
export function resource<T>(_body: () => Generator<unknown, void, unknown>): Workflow<T> {
  throw new Error(
    "resource() is a compiler-recognized form and cannot be called at runtime. Run `tsn generate` to compile your workflow.",
  );
}

/**
 * Provide a value from within a resource body.
 *
 * Compiler-recognized form — `tsn generate` replaces `yield* provide(...)`
 * with IR. Throws if called at runtime without compilation.
 */
export function provide<T>(_value: T): Workflow<void> {
  throw new Error(
    "provide() is a compiler-recognized form and cannot be called at runtime. Run `tsn generate` to compile your workflow.",
  );
}
