import { Type, type Static } from "@sinclair/typebox";

export type Val =
  | string
  | number
  | boolean
  | null
  | Val[]
  | { [key: string]: Val };

export const ValSchema = Type.Unsafe<Val>(
  Type.Recursive(
    (Self) =>
      Type.Union([
        Type.String(),
        Type.Number(),
        Type.Boolean(),
        Type.Null(),
        Type.Array(Self),
        Type.Record(Type.String(), Self),
      ]),
    { $id: "Val" },
  ),
);

export const UsageSummarySchema = Type.Object(
  {
    inputTokens: Type.Optional(Type.Number()),
    outputTokens: Type.Optional(Type.Number()),
    totalTokens: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
export type UsageSummary = Static<typeof UsageSummarySchema>;

export const SpeakerSchema = Type.Union([
  Type.Literal("taras"),
  Type.Literal("opus"),
  Type.Literal("gpt"),
]);
export type Speaker = Static<typeof SpeakerSchema>;

export const PeerSpeakerSchema = Type.Union([Type.Literal("opus"), Type.Literal("gpt")]);
export type PeerSpeaker = Static<typeof PeerSpeakerSchema>;

export const PeerStatusSchema = Type.Union([
  Type.Literal("continue"),
  Type.Literal("needs_taras"),
  Type.Literal("done"),
]);
export type PeerStatus = Static<typeof PeerStatusSchema>;

export const TarasModeSchema = Type.Union([
  Type.Literal("optional"),
  Type.Literal("required"),
]);
export type TarasMode = Static<typeof TarasModeSchema>;

export const TurnEntrySchema = Type.Object({
  speaker: SpeakerSchema,
  content: Type.String(),
  usage: Type.Optional(UsageSummarySchema),
});
export type TurnEntry = Static<typeof TurnEntrySchema>;

export const LoopControlSchema = Type.Object({
  paused: Type.Boolean(),
  stopRequested: Type.Boolean(),
  nextSpeakerOverride: Type.Optional(PeerSpeakerSchema),
});
export type LoopControl = Static<typeof LoopControlSchema>;

export const PeerRecordSchema = Type.Object({
  turnIndex: Type.Number(),
  speaker: PeerSpeakerSchema,
  status: PeerStatusSchema,
  data: Type.Optional(ValSchema),
});
export type PeerRecord = Static<typeof PeerRecordSchema>;

export const RequestedEffectSchema = Type.Object({
  id: Type.String(),
  input: ValSchema,
});
export type RequestedEffect = Static<typeof RequestedEffectSchema>;

export const EffectDispositionSchema = Type.Union([
  Type.Literal("executed"),
  Type.Literal("deferred"),
  Type.Literal("rejected"),
  Type.Literal("surfaced_to_taras"),
]);
export type EffectDisposition = Static<typeof EffectDispositionSchema>;

export const EffectErrorSchema = Type.Object({
  name: Type.String(),
  message: Type.String(),
});
export type EffectError = Static<typeof EffectErrorSchema>;

export const EffectRequestRecordSchema = Type.Object({
  turnIndex: Type.Number(),
  requestor: PeerSpeakerSchema,
  effect: RequestedEffectSchema,
  disposition: EffectDispositionSchema,
  dispositionAt: Type.Number(),
  result: Type.Optional(ValSchema),
  error: Type.Optional(EffectErrorSchema),
});
export type EffectRequestRecord = Static<typeof EffectRequestRecordSchema>;

export const PeerTurnInputSchema = Type.Object({
  transcript: Type.Array(TurnEntrySchema),
  tarasMode: TarasModeSchema,
});
export type PeerTurnInput = Static<typeof PeerTurnInputSchema>;

export const PeerTurnResultSchema = Type.Object({
  display: Type.String(),
  status: PeerStatusSchema,
  data: Type.Optional(ValSchema),
  requestedEffects: Type.Optional(Type.Array(RequestedEffectSchema)),
  usage: Type.Optional(UsageSummarySchema),
});
export type PeerTurnResult = Static<typeof PeerTurnResultSchema>;

export const DEFAULT_LOOP_CONTROL: LoopControl = {
  paused: false,
  stopRequested: false,
};

export const StoreDocumentSchema = Type.Object({
  messages: Type.Array(TurnEntrySchema),
  control: LoopControlSchema,
  peerRecords: Type.Array(PeerRecordSchema),
  effectRequests: Type.Array(EffectRequestRecordSchema),
});
export type StoreDocument = Static<typeof StoreDocumentSchema>;

export const EMPTY_STORE: StoreDocument = {
  messages: [],
  control: DEFAULT_LOOP_CONTROL,
  peerRecords: [],
  effectRequests: [],
};

// --- Browser protocol schemas ---

export const BrowserConnectSchema = Type.Object({
  type: Type.Literal("connect"),
  clientSessionId: Type.String(),
});

export const BrowserUserMessageSchema = Type.Object({
  type: Type.Literal("userMessage"),
  message: Type.String(),
});

export const BrowserControlPatchSchema = Type.Object({
  paused: Type.Optional(Type.Boolean()),
  stopRequested: Type.Optional(Type.Boolean()),
  nextSpeakerOverride: Type.Optional(
    Type.Union([PeerSpeakerSchema, Type.Null()]),
  ),
});
export type BrowserControlPatch = Static<typeof BrowserControlPatchSchema>;

export const BrowserUpdateControlSchema = Type.Object({
  type: Type.Literal("updateControl"),
  patch: BrowserControlPatchSchema,
});

export const BrowserToHostSchema = Type.Union([
  BrowserConnectSchema,
  BrowserUserMessageSchema,
  BrowserUpdateControlSchema,
]);
export type BrowserToHost = Static<typeof BrowserToHostSchema>;

export const HostLoadChatSchema = Type.Object({
  type: Type.Literal("loadChat"),
  messages: Type.Array(TurnEntrySchema),
});

export const HostElicitSchema = Type.Object({
  type: Type.Literal("elicit"),
  message: Type.String(),
});

export const HostShowMessageSchema = Type.Object({
  type: Type.Literal("showMessage"),
  speaker: SpeakerSchema,
  content: Type.String(),
});

export const HostSetReadOnlySchema = Type.Object({
  type: Type.Literal("setReadOnly"),
  reason: Type.String(),
});

export const HostControlSnapshotSchema = Type.Object({
  type: Type.Literal("controlSnapshot"),
  control: LoopControlSchema,
});

export const HostToBrowserSchema = Type.Union([
  HostLoadChatSchema,
  HostElicitSchema,
  HostShowMessageSchema,
  HostSetReadOnlySchema,
  HostControlSnapshotSchema,
]);
export type HostToBrowser = Static<typeof HostToBrowserSchema>;
