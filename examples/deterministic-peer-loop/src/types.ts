export type {
  UsageSummary,
  Speaker,
  PeerSpeaker,
  PeerStatus,
  TarasMode,
  TurnEntry,
  LoopControl,
  PeerRecord,
  RequestedEffect,
  EffectDisposition,
  EffectError,
  EffectRequestRecord,
  PeerTurnInput,
  PeerTurnResult,
  StoreDocument,
  BrowserControlPatch,
  BrowserToHost,
  HostToBrowser,
} from "./schemas.js";

export interface RecursiveState {
  nextSpeaker: "opus" | "gpt";
  tarasMode: "optional" | "required";
  turnCount: number;
}

export type PolicyDecision =
  | { kind: "executed" }
  | { kind: "deferred"; reason?: string }
  | { kind: "rejected"; reason: string }
  | { kind: "surfaced_to_taras"; reason?: string };
