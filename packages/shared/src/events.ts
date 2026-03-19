/**
 * Journal event types for the durable execution protocol.
 *
 * Two event types: Yield and Close.
 * See Tisyn System Specification §11.5 and Conformance Suite §4.5.
 */

import type { Json } from "./values.js";

/** Structured effect identity for journal and divergence detection. */
export interface EffectDescription {
  type: string;
  name: string;
}

/**
 * Result of an event or execution.
 *
 * Conformance suite §4.5: `value` MUST always be present for ok
 * (void → null). Error `message` MUST be non-empty string.
 */
export type EventResult =
  | { status: "ok"; value: Json }
  | { status: "err"; error: { message: string; name?: string } }
  | { status: "cancelled" };

/** A Yield event — an effect was executed and resolved. */
export interface YieldEvent {
  type: "yield";
  coroutineId: string;
  description: EffectDescription;
  result: EventResult;
}

/** A Close event — a coroutine reached a terminal state. */
export interface CloseEvent {
  type: "close";
  coroutineId: string;
  result: EventResult;
}

/** The two event types that make up the durable journal. */
export type DurableEvent = YieldEvent | CloseEvent;

/**
 * Effect descriptor — what the kernel yields to the execution layer.
 *
 * For standard external effects:
 *   { id: "agent-id.methodName", data: Val }
 *
 * For compound external effects (all, race):
 *   { id: "all", data: { exprs: Expr[] } }
 */
export interface EffectDescriptor {
  id: string;
  data: unknown;
}
