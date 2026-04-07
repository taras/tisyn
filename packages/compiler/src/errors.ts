/**
 * Compile errors with source locations.
 *
 * Error codes from Compiler Spec §11.
 */

export class CompileError extends Error {
  override name = "CompileError";
  code: string;
  line: number;
  column: number;

  constructor(code: string, message: string, line: number, column: number) {
    super(`${code} at ${line}:${column}: ${message}`);
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

/** Error code catalog from Compiler Spec §11. */
export const ErrorCodes = {
  // E001 removed: 'let' is now supported
  E002: "Use 'const' instead of 'var'",
  E003: "Reassignment of non-let binding or undeclared name is not allowed",
  E004: "Property mutation is not allowed",
  E005: "Computed property access is not allowed",
  E006: "Math.random() is not allowed (nondeterministic)",
  E007: "Date.now() is not allowed (nondeterministic)",
  E008: "Map/Set constructors are not allowed",
  E009: "async/await is not allowed",
  E010: "yield* must appear in statement position only",
  E011: "Ambiguous '+' operator",
  E013: "for...in/for...of is not allowed",
  E014: "eval()/new Function() is not allowed",
  E033: "'return' inside a finally clause is not supported",
  E034: "catch clause requires a binding parameter",
  E035: "Variable assigned inside 'finally' is not visible after the try statement",
  E016: "class/this is not allowed",
  E017: "yield without * is not allowed",
  E018: "Cannot call arrow function directly",
  E019: "typeof/instanceof is not allowed",
  E020: "break/continue is not allowed",
  E021: "Promise is not allowed",
  E023: "Only 'throw new Error(...)' is allowed",
  E024: "Arrow functions must have expression bodies",
  E028: "Variable names must not start with '__'",
  E029: "delete operator is not allowed",
  E030: "Symbol is not allowed",
  E031: "Mutation method call is not allowed",
  E032: "Spread element outside array or object literal is not allowed",
  // ── Stream iteration (MVP) ──
  "E-STREAM-001": "for...of stream iteration requires 'const', not 'let' or 'var'",
  "E-STREAM-002": "Destructuring in for...of stream iteration is not supported",
  "E-STREAM-003": "for...of with each() requires 'yield*': use 'yield* each(expr)'",
  "E-STREAM-004": "each() can only be used as the iterable in 'for (const x of yield* each(expr))'",
  "E-STREAM-005": "each.next() is not part of the Tisyn authored language",
  "E-STREAM-006": "Nested for...of stream iteration is not supported in this version",
  // ── Timebox ──
  "E-TB-01": "timebox() requires exactly 2 arguments: duration and generator function",
  "E-TB-02": "timebox() second argument must be a generator function expression",
  // ── Converge ──
  "E-CONV-01": "converge() probe must be a generator function expression",
  "E-CONV-02": "converge() until must be an arrow function",
  "E-CONV-03": "converge() until must have an expression body (not a block body)",
  "E-CONV-04": "converge() until must not contain yield*",
  "E-CONV-05": "converge() requires an interval property",
  "E-CONV-06": "converge() requires a timeout property",
  "E-CONV-07": "converge() argument must be an object literal",
  "E-CONV-08": "converge() interval must not contain yield*",
  "E-CONV-09": "converge() timeout must not contain yield*",
  // ── Capability Values ──
  "CV-E1": "Capability value in prohibited position",
  "CV-E2": "Operation on completed capability value",
  "CV-E3": "Double-completion of capability value",
  "CV-E4": "Operation on capability value in indeterminate state",
  "CV-E5": "Capability value must be declared with 'const'",
  // ── useConfig ──
  UC1: "Config.useConfig() requires exactly one ConfigToken argument",
  UC2: "Config.useConfig() argument must be a ConfigToken identifier",
  UC3: "useConfig() must be called as Config.useConfig(Token)",
} as const;
