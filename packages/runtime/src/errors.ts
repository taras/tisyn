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

export class ScopeBindingEffectError extends Error {
  override name = "ScopeBindingEffectError" as const;
  constructor(effectId: string) {
    super(
      `Effect '${effectId}' is not allowed in scope binding expressions. Binding expressions must be pure.`,
    );
  }
}

export class SubscriptionCapabilityError extends Error {
  override name = "SubscriptionCapabilityError" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown at the `yield* ctx.invoke(...)` await site when the invoked child
 * closed with `status: "cancelled"` (either live cancellation propagated via
 * Effection halt, or replay of a previously-cancelled child).
 */
export class InvocationCancelledError extends Error {
  override name = "InvocationCancelledError" as const;
  constructor(message = "Invoked child was cancelled") {
    super(message);
  }
}
