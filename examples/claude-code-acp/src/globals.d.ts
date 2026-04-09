/**
 * Ambient declarations for Tisyn compiler-recognized forms.
 *
 * These are pattern-matched by the Tisyn compiler (`tsn generate`)
 * and do not exist as runtime functions. The declarations here
 * let TypeScript type-check the workflow source without errors.
 */

type Workflow<T> = Generator<unknown, T, unknown>;

declare function resource<T>(
  body: () => Generator<unknown, void, unknown>,
): Workflow<T>;

declare function provide<T>(value: T): Workflow<void>;
