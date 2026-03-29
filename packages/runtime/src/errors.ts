export { EffectError } from "@tisyn/kernel";

export class DivergenceError extends Error {
  override name = "DivergenceError" as const;
  constructor(message: string) {
    super(message);
  }
}

export class RuntimeBugError extends Error {
  override name = "RuntimeBugError" as const;
  constructor(message: string) {
    super(message);
  }
}
