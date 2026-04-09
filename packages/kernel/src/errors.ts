export class UnboundVariable extends Error {
  override name = "UnboundVariable" as const;
  constructor(varName: string) {
    super(`Unbound variable: ${varName}`);
  }
}

export class NotCallable extends Error {
  override name = "NotCallable" as const;
  constructor(message?: string) {
    super(message ?? "Value is not callable");
  }
}

export class ArityMismatch extends Error {
  override name = "ArityMismatch" as const;
  constructor(expected: number, got: number) {
    super(`Expected ${expected} arguments, got ${got}`);
  }
}

export class TypeError extends Error {
  override name = "TypeError" as const;
  constructor(message: string) {
    super(message);
  }
}

export class DivisionByZero extends Error {
  override name = "DivisionByZero" as const;
  constructor() {
    super("Division by zero");
  }
}

export class ExplicitThrow extends Error {
  override name: string = "ExplicitThrow";
  constructor(message: string, originalName?: string) {
    super(message);
    if (originalName) {
      this.name = originalName;
    }
  }
}

export class EffectError extends Error {
  override name: string = "EffectError";
  constructor(message: string, agentErrorName?: string) {
    super(message);
    if (agentErrorName) {
      this.name = agentErrorName;
    }
  }
}

export function isCatchable(e: unknown): boolean {
  return (
    e instanceof ExplicitThrow ||
    e instanceof TypeError ||
    e instanceof NotCallable ||
    e instanceof ArityMismatch ||
    e instanceof UnboundVariable ||
    e instanceof DivisionByZero ||
    e instanceof EffectError
  );
}

export function errorToValue(e: unknown): { message: string; name: string } {
  if (e instanceof Error) {
    return { message: e.message, name: e.name };
  }
  return { message: String(e), name: "Error" };
}

export class ProhibitedEffectError extends Error {
  override name = "ProhibitedEffectError" as const;
  constructor(effectId: string) {
    super(
      `Effect '${effectId}' is not allowed in middleware expressions. ` +
        `Only 'dispatch' effects may be used.`,
    );
  }
}
