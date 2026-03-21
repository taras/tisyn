/**
 * Main compiler entry point.
 *
 * compile(source) → Expr
 *
 * Orchestrates: Parse → Emit → Validate.
 * Produces a Fn node for each generator function in the source.
 * If exactly one function, returns it directly. Otherwise returns
 * an object mapping function names to their compiled IR.
 */

import ts from "typescript";
import type { TisynExpr as Expr } from "@tisyn/ir";
import { validate } from "@tisyn/kernel";
import { parseSource } from "./parse.js";
import { emitBlock, createContext } from "./emit.js";
import { Fn } from "./ir-builders.js";
import { CompileError } from "./errors.js";

export interface CompileOptions {
  /** Run kernel validation on output IR. Default: true. */
  validate?: boolean;
  /** Source filename for error messages. */
  filename?: string;
}

export interface CompileResult {
  /** Map of function names to compiled IR. */
  functions: Record<string, Expr>;
}

/**
 * Compile TypeScript source containing generator functions into Tisyn IR.
 *
 * Each generator function is compiled into a Fn node.
 * Validation runs by default (opt-out via { validate: false }).
 *
 * @throws CompileError for compilation errors
 * @throws MalformedIR for validation failures (when validate is true)
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const { validate: shouldValidate = true, filename = "input.ts" } = options;

  // Phase 1: Parse
  const functions = parseSource(source, filename);

  if (functions.length === 0) {
    throw new CompileError("E999", "No generator functions found in source", 1, 1);
  }

  // Build a source file for location tracking
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const result: Record<string, Expr> = {};

  for (const fn of functions) {
    const ctx = createContext(sourceFile);

    // Phase 2-3: Emit (includes discover and transform)
    const body = emitBlock(fn.body.statements, ctx);

    // Wrap in Fn node
    const irFn = Fn(fn.params, body);

    // Phase 4: Validate
    if (shouldValidate) {
      try {
        validate(irFn);
      } catch (error) {
        if (error instanceof Error && error.name === "MalformedIR") {
          throw new CompileError(
            "V001",
            `Validation failed for function '${fn.name}': ${error.message}`,
            1,
            1,
          );
        }
        throw error;
      }
    }

    result[fn.name] = irFn;
  }

  return { functions: result };
}

/**
 * Compile a single generator function from source.
 *
 * Convenience wrapper: extracts the first (or only) function.
 *
 * @throws CompileError if no generator functions found
 */
export function compileOne(source: string, options: CompileOptions = {}): Expr {
  const result = compile(source, options);
  const names = Object.keys(result.functions);
  if (names.length === 0) {
    throw new CompileError("E999", "No generator functions found", 1, 1);
  }
  return result.functions[names[0]!]!;
}
