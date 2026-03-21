export class EffectError extends Error {
  override name: string = "EffectError";
  constructor(message: string, agentErrorName?: string) {
    super(message);
    if (agentErrorName) {
      this.name = agentErrorName;
    }
  }
}

export class DivergenceError extends Error {
  override name = "DivergenceError" as const;
  constructor(message: string) {
    super(message);
  }
}
