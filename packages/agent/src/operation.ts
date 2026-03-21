import type { OperationSpec } from "./types.js";

/** Declare a typed operation. Runtime value is a marker; types are phantom. */
export function operation<Args = void, Result = unknown>(): OperationSpec<Args, Result> {
  return {} as OperationSpec<Args, Result>;
}
