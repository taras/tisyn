import type { Json, Val } from "@tisyn/ir";

export interface EffectDescription {
  type: string;
  name: string;
  input?: Val;
  sha?: string;
}

export type EventResult =
  | { status: "ok"; value: Json }
  | { status: "error"; error: { message: string; name?: string } }
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

export type DurableEvent = YieldEvent | CloseEvent;

export interface EffectDescriptor {
  id: string;
  data: unknown;
}
