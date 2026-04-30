import type {
  BrowserControlPatch,
  EffectRequestRecord,
  LoopControl,
  PeerRecord,
  TurnEntry,
} from "./schemas.js";

export interface AppState {
  messages: TurnEntry[];
  control: LoopControl;
  peerRecords: PeerRecord[];
  effectRequests: EffectRequestRecord[];
  readOnlyReason: string | null;
}

export type TransitionProposal =
  | { tag: "apply-control-patch"; patch: BrowserControlPatch }
  | { tag: "append-message"; entry: TurnEntry }
  | { tag: "append-peer-record"; record: PeerRecord }
  | { tag: "append-effect-request"; record: EffectRequestRecord }
  | { tag: "set-read-only"; reason: string | null };

export interface AcceptedTransition {
  proposal: TransitionProposal;
  accepted: AppState;
}
