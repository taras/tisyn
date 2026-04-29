/**
 * Conformance harness for the deterministic peer loop (journal-only model).
 *
 * Runs the compiled `peerLoop` workflow against scripted agents and captures
 * the observable sequence of agent-operation calls. The DB agent is gone;
 * the Projection agent is a pure reducer (message/record appends, control
 * patch merges, initial-control read) and the App agent emits only
 * `elicit`, `nextControlPatch`, and `hydrate`. Tests assert against this
 * new surface — never on internal RecursiveState.
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
  Projection,
  peerLoop,
  processEffects,
  dispatchEffect,
  dispatchExecuted,
  drainControlPatches,
} from "../../../src/workflow.generated.js";
import { DEFAULT_LOOP_CONTROL } from "../../../src/schemas.js";
import { mergeControlPatch } from "../../../src/projection-agent.js";
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

export type ApplyControlPatchArgs = {
  current: LoopControl;
  patch: BrowserControlPatch;
};

export type AppendMessageArgs = { messages: TurnEntry[]; entry: TurnEntry };
export type AppendPeerRecordArgs = { records: PeerRecord[]; record: PeerRecord };
export type AppendEffectRequestArgs = {
  records: EffectRequestRecord[];
  record: EffectRequestRecord;
};

export type OperationCall =
  | { agent: "App"; op: "elicit"; args: { message: string } }
  | { agent: "App"; op: "nextControlPatch"; args: Record<string, never> }
  | { agent: "App"; op: "hydrate"; args: HydrateArgs }
  | { agent: "Projection"; op: "readInitialControl"; args: Record<string, never> }
  | {
      agent: "Projection";
      op: "applyControlPatch";
      args: ApplyControlPatchArgs;
    }
  | { agent: "Projection"; op: "appendMessage"; args: AppendMessageArgs }
  | { agent: "Projection"; op: "appendPeerRecord"; args: AppendPeerRecordArgs }
  | {
      agent: "Projection";
      op: "appendEffectRequest";
      args: AppendEffectRequestArgs;
    }
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
   * Initial LoopControl seeded through `Projection.readInitialControl`.
   * Mocks the one production op that the workflow uses to read its starting
   * control value; defaults to `DEFAULT_LOOP_CONTROL` when absent.
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
  /** Final `entry` payloads from each Projection.appendMessage call, in order. */
  appendedMessages: TurnEntry[];
  /** Final `record` payloads from each Projection.appendPeerRecord call, in order. */
  appendedPeerRecords: PeerRecord[];
  /** Final `record` payloads from each Projection.appendEffectRequest call, in order. */
  appendedEffectRequests: EffectRequestRecord[];
  /** One entry per App.hydrate dispatch, in order. */
  hydrateSnapshots: HydrateArgs[];
  /** Last control value threaded through `applyControlPatch` / `readInitialControl`. */
  finalControl: LoopControl;
  /** `readOnlyReason` carried by the most recent hydrate, if any. */
  exitReason?: string;
  terminatedByMaxTurns: boolean;
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
  const initialControl: LoopControl =
    options.seededInitialControl ?? DEFAULT_LOOP_CONTROL;

  let peerTurnIndex = 0;
  let exitReason: string | undefined;
  let terminatedByMaxTurns = false;
  let lastControl: LoopControl = { ...initialControl };

  // Browser-originated control patch buffer. The workflow pulls from this via
  // App.nextControlPatch inside a timebox(0, ...). When the buffer is empty
  // the mock suspends so the timebox expires and the drain exits.
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
  // Queue any patches meant for the pre-first-turn drain.
  enqueuePatchesForTurn(0);

  // Per-cycle queue state for EffectsQueue.seed / shift.
  let queue: RequestedEffect[] = [];

  const done = withResolvers<void>();

  // App: elicit (Taras messages), nextControlPatch (patch buffer drain),
  // hydrate (workflow → binding snapshot).
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
    *hydrate(args) {
      operations.push({ agent: "App", op: "hydrate", args });
      if (args.readOnlyReason !== null) {
        exitReason = args.readOnlyReason;
      }
    },
  });

  // Projection: pure reducer, captures inputs and returns the applied value.
  yield* Agents.use(Projection(), {
    *readInitialControl() {
      operations.push({
        agent: "Projection",
        op: "readInitialControl",
        args: {},
      });
      const snapshot = { ...initialControl };
      lastControl = snapshot;
      return snapshot;
    },
    *applyControlPatch(args) {
      operations.push({
        agent: "Projection",
        op: "applyControlPatch",
        args,
      });
      const next = mergeControlPatch(args.current, args.patch);
      lastControl = next;
      return next;
    },
    *appendMessage(args) {
      operations.push({ agent: "Projection", op: "appendMessage", args });
      return [...args.messages, args.entry];
    },
    *appendPeerRecord(args) {
      operations.push({ agent: "Projection", op: "appendPeerRecord", args });
      return [...args.records, args.record];
    },
    *appendEffectRequest(args) {
      operations.push({
        agent: "Projection",
        op: "appendEffectRequest",
        args,
      });
      return [...args.records, args.record];
    },
  });

  // Opus peer.
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

  // Gpt peer.
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

  // Policy agent — per-effect decisions from the scripted queue.
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

  // EffectsQueue agent — per-cycle FIFO of requested effects.
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

  // EffectHandler agent — scripted dispatch responses.
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

  // Run the compiled workflow in a spawned task so we can cancel / catch exit.
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

  const appendedMessages = operations
    .filter(
      (op): op is Extract<OperationCall, { op: "appendMessage" }> =>
        op.agent === "Projection" && op.op === "appendMessage",
    )
    .map((op) => op.args.entry);
  const appendedPeerRecords = operations
    .filter(
      (op): op is Extract<OperationCall, { op: "appendPeerRecord" }> =>
        op.agent === "Projection" && op.op === "appendPeerRecord",
    )
    .map((op) => op.args.record);
  const appendedEffectRequests = operations
    .filter(
      (op): op is Extract<OperationCall, { op: "appendEffectRequest" }> =>
        op.agent === "Projection" && op.op === "appendEffectRequest",
    )
    .map((op) => op.args.record);
  const hydrateSnapshots = operations
    .filter(
      (op): op is Extract<OperationCall, { op: "hydrate" }> =>
        op.agent === "App" && op.op === "hydrate",
    )
    .map((op) => op.args);

  return {
    operations,
    appendedMessages,
    appendedPeerRecords,
    appendedEffectRequests,
    hydrateSnapshots,
    finalControl: lastControl,
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
