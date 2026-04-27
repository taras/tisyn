/**
 * Projection agent — pure reducer over workflow-local state.
 *
 * Holds no cross-call state, performs no I/O, does not read the journal.
 * Every operation is a pure function of its inputs; the workflow threads
 * state through locals and the runtime's replay index restores those locals
 * by re-executing recorded agent-op return values on restart.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import {
  DEFAULT_LOOP_CONTROL,
  type BrowserControlPatch,
  type EffectRequestRecord,
  type LoopControl,
  type PeerRecord,
  type TurnEntry,
} from "./schemas.js";

export const Projection = () =>
  agent("projection", {
    readInitialControl: operation<Record<string, never>, LoopControl>(),
    applyControlPatch: operation<
      { current: LoopControl; patch: BrowserControlPatch },
      LoopControl
    >(),
    appendMessage: operation<{ messages: TurnEntry[]; entry: TurnEntry }, TurnEntry[]>(),
    appendPeerRecord: operation<{ records: PeerRecord[]; record: PeerRecord }, PeerRecord[]>(),
    appendEffectRequest: operation<
      { records: EffectRequestRecord[]; record: EffectRequestRecord },
      EffectRequestRecord[]
    >(),
  });

/**
 * Merge a browser-sent control patch onto the current LoopControl.
 * - `undefined` in a patch field preserves the current value.
 * - `null` for `nextSpeakerOverride` clears the field.
 * - A concrete value replaces the current value.
 */
export function mergeControlPatch(
  current: LoopControl,
  patch: BrowserControlPatch,
): LoopControl {
  const next: LoopControl = {
    paused: patch.paused ?? current.paused,
    stopRequested: patch.stopRequested ?? current.stopRequested,
  };
  if (patch.nextSpeakerOverride === null) {
    // explicit clear — leave field absent
  } else if (patch.nextSpeakerOverride !== undefined) {
    next.nextSpeakerOverride = patch.nextSpeakerOverride;
  } else if (current.nextSpeakerOverride !== undefined) {
    next.nextSpeakerOverride = current.nextSpeakerOverride;
  }
  return next;
}

export function createBinding(_config?: Record<string, unknown>): LocalAgentBinding {
  return {
    transport: inprocessTransport(Projection(), {
      *readInitialControl() {
        return DEFAULT_LOOP_CONTROL;
      },
      *applyControlPatch({ current, patch }) {
        return mergeControlPatch(current, patch);
      },
      *appendMessage({ messages, entry }) {
        return [...messages, entry];
      },
      *appendPeerRecord({ records, record }) {
        return [...records, record];
      },
      *appendEffectRequest({ records, record }) {
        return [...records, record];
      },
    }),
  };
}
