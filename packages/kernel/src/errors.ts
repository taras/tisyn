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
  override name = "ExplicitThrow" as const;
  constructor(message: string) {
    super(message);
  }
}
