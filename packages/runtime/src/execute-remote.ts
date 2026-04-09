import type { Operation } from "effection";
import type { TisynExpr as Expr, Val, Json } from "@tisyn/ir";
import { execute } from "./execute.js";

export interface ExecuteRemoteOptions {
  /** The Tisyn IR program to execute. */
  program: Expr;
  /** Environment bindings for the program. */
  env?: Record<string, Val>;
}

/**
 * Execute a received Tisyn program, returning the result value or throwing on error.
 *
 * Thin wrapper around execute() for the proxy.run pattern.
 * The thrown Error includes `cause` set to the full EventResult.
 */
export function* executeRemote(options: ExecuteRemoteOptions): Operation<Json> {
  const { result } = yield* execute({ ir: options.program, env: options.env });
  if (result.status === "ok") {
    return result.value;
  }
  if (result.status === "error") {
    throw new Error(result.error.message, { cause: result });
  }
  throw new Error("Execution was cancelled", { cause: result });
}
