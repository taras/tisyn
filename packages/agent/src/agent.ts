import type { OperationSpec, DeclaredAgent } from "./types.js";

/**
 * Declare an agent with typed operations.
 *
 * Returns the declaration plus host-side call constructors that
 * produce invocation data (they do not execute the operation).
 */
export function agent<const Ops extends Record<string, OperationSpec<any, any>>>(
  id: string,
  operations: Ops,
): DeclaredAgent<Ops> {
  const calls: Record<string, Function> = {};
  for (const opName of Object.keys(operations)) {
    calls[opName] = (args: unknown) => ({
      effectId: `${id}.${opName}`,
      data: args,
    });
  }
  return Object.assign({ id, operations }, calls) as never;
}
