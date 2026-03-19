/**
 * Tisyn error types.
 *
 * All 9 error types from Conformance Suite §4.1.
 * Each has a `name` property matching the canonical string exactly.
 */

/** Raised when IR structure is invalid (validation phase). */
export class MalformedIR extends Error {
  override name = "MalformedIR" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Raised when a Ref lookup fails in the environment. */
export class UnboundVariable extends Error {
  override name = "UnboundVariable" as const;
  constructor(varName: string) {
    super(`Unbound variable: ${varName}`);
  }
}

/** Raised when call is applied to a non-Fn value. */
export class NotCallable extends Error {
  override name = "NotCallable" as const;
  constructor(message?: string) {
    super(message ?? "Value is not callable");
  }
}

/** Raised when function call has wrong number of arguments. */
export class ArityMismatch extends Error {
  override name = "ArityMismatch" as const;
  constructor(expected: number, got: number) {
    super(`Expected ${expected} arguments, got ${got}`);
  }
}

/** Raised when an operator receives an invalid operand type. */
export class TypeError extends Error {
  override name = "TypeError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Raised when dividing or modding by zero. */
export class DivisionByZero extends Error {
  override name = "DivisionByZero" as const;
  constructor() {
    super("Division by zero");
  }
}

/** Raised when a throw node is evaluated. */
export class ExplicitThrow extends Error {
  override name = "ExplicitThrow" as const;
  constructor(message: string) {
    super(message);
  }
}

/** Raised when an agent returns an error result. */
export class EffectError extends Error {
  override name: string = "EffectError";
  constructor(message: string, agentErrorName?: string) {
    super(message);
    if (agentErrorName) {
      // Kernel MUST NOT modify agent error name — pass it through
      this.name = agentErrorName;
    }
  }
}

/** Raised when replay journal doesn't match current execution. */
export class DivergenceError extends Error {
  override name = "DivergenceError" as const;
  constructor(message: string) {
    super(message);
  }
}
