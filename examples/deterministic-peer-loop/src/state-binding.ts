/**
 * Synthetic `state-agent` agent binding for the State Primitive Spike.
 *
 * Two operations:
 *   - readInitialState: returns the authority's current state
 *     (seeded from the journal at host startup). Recorded as a
 *     YieldEvent so the workflow can re-read it deterministically
 *     under replay.
 *   - transition(proposal): applies the reducer via the authority,
 *     fires subscribers, returns the accepted AppState directly. The
 *     proposal is preserved durably in `event.description.input`
 *     (see Phase 5 report).
 *
 * Note: the spike originally intended `peerLoop` to read state via
 * a synchronous module-level call to `authority.getState()`. The
 * tsn compiler treats unresolved identifiers in workflow bodies as
 * untracked refs (see `packages/compiler/src/emit.ts` resolveRef),
 * so any deterministic read must yield through an agent surface.
 * `readInitialState` is a clean read op — it is *not* a no-op
 * `transition` and does not impersonate a state mutation.
 */

import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { authority } from "./state-authority.js";
import type { AppState, TransitionProposal } from "./state-types.js";

export const StateAgent = () =>
  agent("state-agent", {
    readInitialState: operation<Record<string, never>, AppState>(),
    transition: operation<TransitionProposal, AppState>(),
  });

export function createBinding(_config?: Record<string, unknown>): LocalAgentBinding {
  return {
    transport: inprocessTransport(StateAgent(), {
      *readInitialState() {
        return authority.getState();
      },
      *transition(proposal) {
        return authority.accept(proposal).accepted;
      },
    }),
  };
}
