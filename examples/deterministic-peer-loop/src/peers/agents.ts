import { agent, operation } from "@tisyn/agent";
import type { PeerTurnInput, PeerTurnResult } from "../schemas.js";

export const OpusAgent = () =>
  agent("opus-agent", {
    takeTurn: operation<PeerTurnInput, PeerTurnResult>(),
  });

export const GptAgent = () =>
  agent("gpt-agent", {
    takeTurn: operation<PeerTurnInput, PeerTurnResult>(),
  });
