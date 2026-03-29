import type { Json } from "@tisyn/ir";

export interface EffectDescription {
  type: string;
  name: string;
}

export type EventResult =
  | { status: "ok"; value: Json }
  | { status: "err"; error: { message: string; name?: string } }
  | { status: "cancelled" };

export interface YieldEvent {
  type: "yield";
  coroutineId: string;
  description: EffectDescription;
  result: EventResult;
}

export interface CloseEvent {
  type: "close";
  coroutineId: string;
  result: EventResult;
}

/** Inputs recorded at the start of a durable execution for replay validation. */
export interface StartEvent {
  type: "start";
  coroutineId: string;
  inputs: {
    middleware?: Json | null;
    args?: Json | null;
  };
}

export type DurableEvent = YieldEvent | CloseEvent | StartEvent;

export interface EffectDescriptor {
  id: string;
  data: unknown;
}
