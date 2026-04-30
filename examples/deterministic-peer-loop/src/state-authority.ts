/**
 * Example-local state authority for the State Primitive Spike.
 *
 * Module-level singleton:
 *   - getState() returns the current accepted AppState.
 *   - subscribe(listener) installs an observer; returns an unsubscribe.
 *   - accept(proposal) applies the pure reducer to the current state,
 *     stores the new state, fires subscribers, and returns the
 *     {proposal, accepted} envelope.
 *   - seed(prior) replays a sequence of accepted transitions onto an
 *     empty initial state without firing subscribers.
 *
 * The reducer is pure. mergeControlPatch is copied verbatim from the
 * soon-to-be-deleted `projection-agent.ts` so the Phase 4 deletion
 * does not lose the helper.
 */

import { DEFAULT_LOOP_CONTROL, type BrowserControlPatch, type LoopControl } from "./schemas.js";
import type { AcceptedTransition, AppState, TransitionProposal } from "./state-types.js";

export const EMPTY_APP_STATE: AppState = {
  messages: [],
  control: DEFAULT_LOOP_CONTROL,
  peerRecords: [],
  effectRequests: [],
  readOnlyReason: null,
};

export function mergeControlPatch(current: LoopControl, patch: BrowserControlPatch): LoopControl {
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

function reduce(state: AppState, proposal: TransitionProposal): AppState {
  switch (proposal.tag) {
    case "apply-control-patch":
      return { ...state, control: mergeControlPatch(state.control, proposal.patch) };
    case "append-message":
      return { ...state, messages: [...state.messages, proposal.entry] };
    case "append-peer-record":
      return { ...state, peerRecords: [...state.peerRecords, proposal.record] };
    case "append-effect-request":
      return { ...state, effectRequests: [...state.effectRequests, proposal.record] };
    case "set-read-only":
      return { ...state, readOnlyReason: proposal.reason };
  }
}

export type Listener = (snapshot: AppState) => void;

export interface Authority {
  getState(): AppState;
  subscribe(listener: Listener): () => void;
  accept(proposal: TransitionProposal): AcceptedTransition;
  seed(prior: AppState[]): void;
  reset(): void;
}

function createAuthority(): Authority {
  let current: AppState = EMPTY_APP_STATE;
  const listeners = new Set<Listener>();

  return {
    getState() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    accept(proposal) {
      current = reduce(current, proposal);
      const accepted = current;
      for (const listener of listeners) {
        listener(accepted);
      }
      return { proposal, accepted };
    },
    seed(prior) {
      // Result-based fold (Phase 3.5 step 2): each recorded transition
      // result is the post-state snapshot, so the seed result is just
      // the last entry. The reducer is not re-run during seed, and
      // subscribers are not fired.
      //
      // Note: the spike originally typed transition results as
      // `AcceptedTransition = {proposal, accepted}`, but the workflow
      // body's IR type system can't narrow `Get(ref, "accepted")`
      // back to `AppState`, so the binding now returns the bare
      // `AppState`. The proposal remains durable as
      // `description.input` on the YieldEvent (PR #145).
      if (prior.length > 0) {
        current = prior[prior.length - 1];
      }
    },
    reset() {
      current = EMPTY_APP_STATE;
      listeners.clear();
    },
  };
}

export const authority: Authority = createAuthority();
