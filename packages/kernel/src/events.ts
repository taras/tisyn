import type { Json } from "@tisyn/ir";

export interface EffectDescription {
  type: string;
  name: string;
  /**
   * Deterministic payload fingerprint: `payloadSha(data)` computed at
   * YieldEvent-write time — equivalently, `sha256(canonical(data))` as a
   * lower-case hex string. The runtime's replay divergence check (see
   * `tisyn-scoped-effects-specification.md` §9.5) compares type + name + this
   * fingerprint to the current dispatched effect; mismatch raises
   * `DivergenceError`.
   *
   * Absent on legacy journal entries written before this field existed — the
   * runtime replays those under legacy semantics (no payload check for that
   * single entry). New entries written by the runtime always include it.
   */
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
