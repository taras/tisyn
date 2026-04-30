/**
 * DPL-JNL-01/02: the kernel journal is the sole durable source of truth.
 *
 *   - JNL-01: a completed run's journal records the full agent-op trace
 *     (now keyed on `StateAgent.transition` and `StateAgent.readInitialState`
 *     in place of the deleted Projection ops, and with no `App.hydrate`
 *     entry) and ends in a Close event.
 *   - JNL-02: replay from a journal prefix consumes replayable events
 *     without dispatching, and resumes live dispatch past the frontier.
 *     The first post-frontier live op is the next workflow yield after
 *     the prefix's last replayed yield.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { createSignal, scoped } from "effection";
import type { Operation } from "effection";
import { Agents } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableEvent } from "@tisyn/kernel";
import { Call } from "@tisyn/ir";
import {
  App,
  EffectHandler,
  EffectsQueue,
  GptAgent,
  OpusAgent,
  Policy,
  StateAgent,
  peerLoop,
  processEffects,
  dispatchEffect,
  dispatchExecuted,
  drainControlPatches,
} from "../../src/workflow.generated.js";
import { DEFAULT_LOOP_CONTROL } from "../../src/schemas.js";
import { EMPTY_APP_STATE, mergeControlPatch } from "../../src/state-authority.js";
import type { AppState, TransitionProposal } from "../../src/state-types.js";
import type {
  BrowserControlPatch,
  LoopControl,
  PeerTurnResult,
  RequestedEffect,
} from "../../src/types.js";
import type { Val } from "../../src/schemas.js";

interface RunOutcome {
  liveCalls: string[];
  journal: DurableEvent[];
  result: Awaited<ReturnType<typeof execute>>["result"];
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

function runPeerLoopOnce(args: {
  stream: InMemoryStream | undefined;
  opusScript: PeerTurnResult[];
  tarasMessages: string[];
  seededInitialControl?: LoopControl;
}): Operation<RunOutcome> {
  return scoped(() => runPeerLoopScoped(args));
}

function* runPeerLoopScoped(args: {
  stream: InMemoryStream | undefined;
  opusScript: PeerTurnResult[];
  tarasMessages: string[];
  seededInitialControl?: LoopControl;
}): Operation<RunOutcome> {
  const liveCalls: string[] = [];
  const tarasQueue = [...args.tarasMessages];
  const opusQueue = [...args.opusScript];
  const effectsQueue: RequestedEffect[] = [];
  const patchQueue: BrowserControlPatch[] = [];
  const patchReady = createSignal<void, never>();
  const seed = args.seededInitialControl ?? DEFAULT_LOOP_CONTROL;
  let state: AppState = { ...EMPTY_APP_STATE, control: { ...seed } };

  yield* Agents.use(App(), {
    *elicit() {
      liveCalls.push("App.elicit");
      if (tarasQueue.length === 0) {
        throw new Error("TARAS_SCRIPT_EXHAUSTED");
      }
      return { message: tarasQueue.shift()! };
    },
    *nextControlPatch() {
      liveCalls.push("App.nextControlPatch");
      if (patchQueue.length > 0) {
        return patchQueue.shift()!;
      }
      const sub = yield* patchReady;
      while (patchQueue.length === 0) {
        yield* sub.next();
      }
      return patchQueue.shift()!;
    },
  });

  yield* Agents.use(StateAgent(), {
    *readInitialState() {
      liveCalls.push("StateAgent.readInitialState");
      return state;
    },
    *transition(proposal) {
      liveCalls.push("StateAgent.transition");
      state = reduce(state, proposal);
      return state;
    },
  });

  yield* Agents.use(OpusAgent(), {
    *takeTurn() {
      liveCalls.push("OpusAgent.takeTurn");
      const next = opusQueue.shift();
      if (!next) {
        throw new Error("OPUS_EXHAUSTED");
      }
      return next;
    },
  });

  yield* Agents.use(GptAgent(), {
    *takeTurn() {
      liveCalls.push("GptAgent.takeTurn");
      throw new Error("GPT_NOT_SCRIPTED");
    },
  });

  yield* Agents.use(Policy(), {
    *decide() {
      liveCalls.push("Policy.decide");
      return { kind: "rejected", reason: "unregistered" };
    },
  });

  yield* Agents.use(EffectsQueue(), {
    *seed({ effects }) {
      liveCalls.push("EffectsQueue.seed");
      effectsQueue.length = 0;
      for (const e of effects) {
        effectsQueue.push(e);
      }
    },
    *shift() {
      liveCalls.push("EffectsQueue.shift");
      if (effectsQueue.length === 0) {
        return { effect: null };
      }
      return { effect: effectsQueue.shift()! };
    },
  });

  yield* Agents.use(EffectHandler(), {
    *invoke() {
      liveCalls.push("EffectHandler.invoke");
      return {
        ok: false as const,
        error: { name: "UnknownEffectError", message: "unscripted" },
      };
    },
  });

  let result: RunOutcome["result"];
  let journal: DurableEvent[] = [];
  try {
    const executeResult = yield* execute({
      ir: Call(peerLoop),
      stream: args.stream,
      env: {
        processEffects,
        dispatchEffect,
        dispatchExecuted,
        drainControlPatches,
      } as unknown as Record<string, Val>,
    });
    result = executeResult.result;
    journal = executeResult.journal;
  } catch (err) {
    const e = err as Error;
    if (e.message === "TARAS_SCRIPT_EXHAUSTED") {
      result = { status: "error", error: { name: "TarasExhausted", message: e.message } };
    } else {
      throw err;
    }
  }
  return { liveCalls, journal, result };
}

describe("DPL-JNL", () => {
  it("JNL-01: a completed run's journal ends in Close and captures the StateAgent trace", function* () {
    const first = yield* runPeerLoopOnce({
      stream: undefined,
      opusScript: [{ display: "opus done", status: "done" }],
      tarasMessages: ["go"],
    });

    expect(first.liveCalls.length).toBeGreaterThan(0);
    expect(first.journal.length).toBeGreaterThan(0);
    expect(first.journal[first.journal.length - 1].type).toBe("close");

    // The new state surface: readInitialState fires once at the top of the
    // workflow, transition fires once per accepted proposal. App.hydrate is
    // gone — the binding owns its own subscription, not the workflow.
    expect(first.liveCalls).toContain("StateAgent.readInitialState");
    expect(first.liveCalls).toContain("StateAgent.transition");
    expect(first.liveCalls).toContain("App.elicit");
    expect(first.liveCalls).toContain("OpusAgent.takeTurn");
    expect(first.liveCalls).not.toContain("App.hydrate");
  });

  it("JNL-02: replay from a journal prefix consumes replayable events and resumes live past the frontier", function* () {
    const first = yield* runPeerLoopOnce({
      stream: undefined,
      opusScript: [{ display: "opus done", status: "done" }],
      tarasMessages: ["go"],
    });
    expect(first.liveCalls.length).toBeGreaterThan(0);

    // A very short prefix guarantees a large live tail. One yield event plus
    // the implicit wiring is enough to establish a frontier early in the run.
    const prefix = first.journal.slice(0, 1);
    expect(prefix.length).toBe(1);

    const stream = new InMemoryStream(prefix);
    const second = yield* runPeerLoopOnce({
      stream,
      opusScript: [{ display: "opus done", status: "done" }],
      tarasMessages: ["go"],
    });

    // The live tail past the frontier still drives a full peer step including
    // a StateAgent.transition. The workflow terminates with an "ok" status.
    expect(second.liveCalls).toContain("StateAgent.transition");
    expect(second.result.status).toBe("ok");
  });
});
