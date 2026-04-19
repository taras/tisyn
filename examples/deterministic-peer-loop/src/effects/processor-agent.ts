import { agent, operation } from "@tisyn/agent";
import type {
  EffectRequestRecord,
  PeerSpeaker,
  RequestedEffect,
} from "../types.js";

export const EffectsProcessor = () =>
  agent("effects-processor", {
    processAll: operation<
      {
        effects: RequestedEffect[];
        turnIndex: number;
        requestor: PeerSpeaker;
      },
      EffectRequestRecord[]
    >(),
  });
