/**
 * Conformance harness for the deterministic peer loop (state-primitive spike).
 *
 * Runs the compiled `peerLoop` workflow against scripted agents and captures
 * the observable sequence of agent-operation calls.
 *
 * Spike change vs. journal-only model: the Projection agent is gone. Its
 * five reducer ops are replaced by `StateAgent.transition(proposal)` (a
 * single op carrying a discriminated `TransitionProposal`) plus
 * `StateAgent.readInitialState({})` (initial-state read at workflow start).
 * The App agent's `hydrate` op is gone — every accepted snapshot is captured
 * here via an in-test reducer subscription, and `hydrateSnapshots` is now
 * derived from those snapshots so existing test assertions keep working.
 */

import { createSignal, spawn, suspend, withResolvers } from "effection";
import type { Operation } from "effection";
import { Agents } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
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
} from "../../../src/workflow.generated.js";
import { DEFAULT_LOOP_CONTROL } from "../../../src/schemas.js";
import { mergeControlPatch, EMPTY_APP_STATE } from "../../../src/state-authority.js";
import type { AppState, TransitionProposal } from "../../../src/state-types.js";
import type {
  BrowserControlPatch,
  EffectRequestRecord,
  LoopControl,
  PeerRecord,
  PeerSpeaker,
  PeerTurnInput,
  PeerTurnResult,
  PolicyDecision,
  RequestedEffect,
  TurnEntry,
} from "../../../src/types.js";
import type { Val } from "../../../src/schemas.js";

// ── OperationCall capture ──

export type HydrateArgs = {
  messages: TurnEntry[];
  control: LoopControl;
  readOnlyReason: string | null;
};

export type OperationCall =
  | { agent: "App"; op: "elicit"; args: { message: string } }
  | { agent: "App"; op: "nextControlPatch"; args: Record<string, never> }
  | { agent: "StateAgent"; op: "readInitialState"; args: Record<string, never> }
  | { agent: "StateAgent"; op: "transition"; args: TransitionProposal }
  | { agent: "OpusAgent"; op: "takeTurn"; args: PeerTurnInput }
  | { agent: "GptAgent"; op: "takeTurn"; args: PeerTurnInput }
  | { agent: "Policy"; op: "decide"; args: { effect: RequestedEffect } }
  | { agent: "EffectsQueue"; op: "seed"; args: { effects: RequestedEffect[] } }
  | { agent: "EffectsQueue"; op: "shift"; args: Record<string, never> }
  | {
      agent: "EffectHandler";
      op: "invoke";
      args: { effectId: string; data: Val };
    };

/** Scripted dispatch result fed to the EffectHandler mock. */
export type DispatchResult =
  | { ok: true; result: Val }
  | { ok: false; error: { name: string; message: string } };

export interface HarnessOptions {
  /**
   * Initial LoopControl seeded into the harness's authority. The workflow
   * reads this via `StateAgent.readInitialState`. Defaults to
   * `DEFAULT_LOOP_CONTROL`.
   */
  seededInitialControl?: LoopControl;
  /** Scripted Taras messages consumed in order by App.elicit. */
  tarasMessages?: string[];
  /** Scripted Opus results consumed in order by OpusAgent.takeTurn. */
  opusScript?: PeerTurnResult[];
  /** Scripted Gpt results consumed in order by GptAgent.takeTurn. */
  gptScript?: PeerTurnResult[];
  /**
   * Scripted Policy.decide outputs. One decision per call, in order.
   * Missing entries default to { kind: "rejected", reason: "unregistered" }.
   */
  policyScript?: PolicyDecision[];
  /**
   * Scripted EffectHandler.invoke outputs. Consumed only when Policy returns
   * { kind: "executed" }. Missing entries produce UnknownEffectError.
   */
  dispatchScript?: DispatchResult[];
  /**
   * Queue browser-originated control patches immediately after the keyed
   * peer turn completes. On the next iteration's post-gate drain the
   * workflow pulls them via App.nextControlPatch in FIFO order. Use key 0
   * to queue patches that will be drained on iteration 1 (before any peer
   * turn has fired).
   */
  controlPatchesAfterTurn?: Record<number, BrowserControlPatch[]>;
  /** Hard ceiling on peer turns before the harness halts the workflow. */
  maxTurns?: number;
}

export interface HarnessResult {
  operations: OperationCall[];
  /** Each TurnEntry that flowed through `append-message` proposals, in order. */
  appendedMessages: TurnEntry[];
  /** Each PeerRecord that flowed through `append-peer-record` proposals, in order. */
  appendedPeerRecords: PeerRecord[];
  /** Each EffectRequestRecord that flowed through `append-effect-request` proposals, in order. */
  appendedEffectRequests: EffectRequestRecord[];
  /**
   * Snapshot accumulated *after each accepted transition*. Synthesized from
   * the harness-side reducer applied to every observed transition proposal.
   * Stand-in for the deleted `App.hydrate` snapshots; tests that previously
   * asserted on hydrate snapshots assert on the equivalent suffix here.
   */
  hydrateSnapshots: HydrateArgs[];
  /** Last LoopControl observed in the rolling state. */
  finalControl: LoopControl;
  /** `readOnlyReason` carried by the most recent accepted snapshot, if any. */
  exitReason?: string;
  terminatedByMaxTurns: boolean;
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

/** Run the compiled peerLoop workflow under the harness. */
export function* runHarness(options: HarnessOptions): Operation<HarnessResult> {
  const operations: OperationCall[] = [];

  const tarasMessages = [...(options.tarasMessages ?? [])];
  const opusScript = [...(options.opusScript ?? [])];
  const gptScript = [...(options.gptScript ?? [])];
  const policyScript = [...(options.policyScript ?? [])];
  const dispatchScript = [...(options.dispatchScript ?? [])];
  const maxTurns = options.maxTurns ?? 20;
  const initialControl: LoopControl = options.seededInitialControl ?? DEFAULT_LOOP_CONTROL;

  let peerTurnIndex = 0;
  let exitReason: string | undefined;
  let terminatedByMaxTurns = false;

  // Harness-local authority mirror. Initial state seeded with the requested
  // initialControl. `state` is reassigned after every observed transition so
  // hydrateSnapshots reflects the authority-derived view a real subscriber
  // would see.
  let state: AppState = { ...EMPTY_APP_STATE, control: { ...initialControl } };
  const hydrateSnapshots: HydrateArgs[] = [];
  const appendedMessages: TurnEntry[] = [];
  const appendedPeerRecords: PeerRecord[] = [];
  const appendedEffectRequests: EffectRequestRecord[] = [];

  // The first accepted snapshot the workflow ever sees is the seeded initial
  // state — push it into hydrateSnapshots up front so tests that assert
  // `hydrateSnapshots[0].messages === []` still see the seed snapshot.
  hydrateSnapshots.push({
    messages: [...state.messages],
    control: { ...state.control },
    readOnlyReason: state.readOnlyReason,
  });

  const recordTransition = (proposal: TransitionProposal) => {
    state = reduce(state, proposal);
    if (proposal.tag === "append-message") {
      appendedMessages.push(proposal.entry);
    } else if (proposal.tag === "append-peer-record") {
      appendedPeerRecords.push(proposal.record);
    } else if (proposal.tag === "append-effect-request") {
      appendedEffectRequests.push(proposal.record);
    } else if (proposal.tag === "set-read-only" && proposal.reason !== null) {
      exitReason = proposal.reason;
    }
    hydrateSnapshots.push({
      messages: [...state.messages],
      control: { ...state.control },
      readOnlyReason: state.readOnlyReason,
    });
  };

  // Browser-originated control patch buffer.
  const patchQueue: BrowserControlPatch[] = [];
  const patchReady = createSignal<void, never>();

  const enqueuePatchesForTurn = (turn: number) => {
    const queued = options.controlPatchesAfterTurn?.[turn];
    if (!queued) {
      return;
    }
    for (const patch of queued) {
      patchQueue.push(patch);
    }
    patchReady.send();
  };
  enqueuePatchesForTurn(0);

  // Per-cycle queue state for EffectsQueue.seed / shift.
  let queue: RequestedEffect[] = [];

  const done = withResolvers<void>();

  yield* Agents.use(App(), {
    *elicit(args) {
      operations.push({ agent: "App", op: "elicit", args });
      if (tarasMessages.length === 0) {
        done.resolve();
        throw new Error("TARAS_SCRIPT_EXHAUSTED");
      }
      return { message: tarasMessages.shift()! };
    },
    *nextControlPatch() {
      operations.push({ agent: "App", op: "nextControlPatch", args: {} });
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
      operations.push({
        agent: "StateAgent",
        op: "readInitialState",
        args: {},
      });
      return state;
    },
    *transition(args) {
      operations.push({ agent: "StateAgent", op: "transition", args });
      recordTransition(args);
      return state;
    },
  });

  yield* Agents.use(OpusAgent(), {
    *takeTurn(args) {
      operations.push({ agent: "OpusAgent", op: "takeTurn", args });
      peerTurnIndex = peerTurnIndex + 1;
      if (peerTurnIndex > maxTurns) {
        terminatedByMaxTurns = true;
        done.resolve();
        throw new Error("MAX_TURNS_EXCEEDED");
      }
      const script = opusScript.shift();
      if (!script) {
        throw new Error(`Opus script exhausted at peer turn ${peerTurnIndex}`);
      }
      enqueuePatchesForTurn(peerTurnIndex);
      return script;
    },
  });

  yield* Agents.use(GptAgent(), {
    *takeTurn(args) {
      operations.push({ agent: "GptAgent", op: "takeTurn", args });
      peerTurnIndex = peerTurnIndex + 1;
      if (peerTurnIndex > maxTurns) {
        terminatedByMaxTurns = true;
        done.resolve();
        throw new Error("MAX_TURNS_EXCEEDED");
      }
      const script = gptScript.shift();
      if (!script) {
        throw new Error(`GPT script exhausted at peer turn ${peerTurnIndex}`);
      }
      enqueuePatchesForTurn(peerTurnIndex);
      return script;
    },
  });

  yield* Agents.use(Policy(), {
    *decide(args) {
      operations.push({ agent: "Policy", op: "decide", args });
      const next = policyScript.shift();
      if (next !== undefined) {
        return next;
      }
      return { kind: "rejected", reason: "unregistered" };
    },
  });

  yield* Agents.use(EffectsQueue(), {
    *seed(args) {
      operations.push({ agent: "EffectsQueue", op: "seed", args });
      queue = [...args.effects];
    },
    *shift() {
      operations.push({ agent: "EffectsQueue", op: "shift", args: {} });
      if (queue.length === 0) {
        return { effect: null };
      }
      const effect = queue[0];
      queue = queue.slice(1);
      return { effect };
    },
  });

  yield* Agents.use(EffectHandler(), {
    *invoke(args) {
      operations.push({ agent: "EffectHandler", op: "invoke", args });
      const next = dispatchScript.shift();
      if (next === undefined) {
        return {
          ok: false as const,
          error: {
            name: "UnknownEffectError",
            message: `Unknown effect: ${args.effectId}`,
          },
        };
      }
      if (next.ok) {
        return { ok: true as const, result: next.result };
      }
      return { ok: false as const, error: next.error };
    },
  });

  const task = yield* spawn(function* () {
    try {
      yield* execute({
        ir: Call(peerLoop),
        env: {
          processEffects,
          dispatchEffect,
          dispatchExecuted,
          drainControlPatches,
        } as unknown as Record<string, Val>,
      });
    } catch (err) {
      const e = err as Error;
      if (e.message !== "TARAS_SCRIPT_EXHAUSTED" && e.message !== "MAX_TURNS_EXCEEDED") {
        if (exitReason === undefined) {
          exitReason = `error: ${e.message}`;
        }
      }
    }
    done.resolve();
    yield* suspend();
  });

  yield* done.operation;
  yield* task.halt();

  return {
    operations,
    appendedMessages,
    appendedPeerRecords,
    appendedEffectRequests,
    hydrateSnapshots,
    finalControl: { ...state.control },
    exitReason,
    terminatedByMaxTurns,
  };
}

// ── Fixture builders ──

export function opusTurn(partial: Partial<PeerTurnResult>): PeerTurnResult {
  return {
    display: "opus-says",
    status: "continue",
    ...partial,
  };
}

export function gptTurn(partial: Partial<PeerTurnResult>): PeerTurnResult {
  return {
    display: "gpt-says",
    status: "continue",
    ...partial,
  };
}

export function taras(content: string): TurnEntry {
  return { speaker: "taras", content };
}

export function peer(speaker: PeerSpeaker, content: string, usage?: TurnEntry["usage"]): TurnEntry {
  return usage !== undefined ? { speaker, content, usage } : { speaker, content };
}

export function effect(id: string, input: Val = null): RequestedEffect {
  return { id, input };
}
