/**
 * Conformance harness for the deterministic peer loop.
 *
 * Runs the compiled `peerLoop` workflow against scripted agents and captures
 * the observable sequence of agent-operation calls (the `OperationCall`
 * record from the test plan §4.3). Used to assert on the exact dispatch
 * sequence, persisted records, and final control state — never on internal
 * RecursiveState.
 */

import { spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { Agents } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { Call } from "@tisyn/ir";
import {
  App,
  DB,
  EffectHandler,
  EffectsQueue,
  GptAgent,
  OpusAgent,
  Policy,
  peerLoop,
  processEffects,
  dispatchEffect,
  dispatchExecuted,
} from "../../../src/workflow.generated.js";
import type {
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

export type OperationCall =
  | { agent: "App"; op: "elicit"; args: { message: string } }
  | { agent: "App"; op: "showMessage"; args: { entry: TurnEntry } }
  | { agent: "App"; op: "loadChat"; args: { messages: TurnEntry[] } }
  | { agent: "App"; op: "readControl"; args: Record<string, never> }
  | { agent: "App"; op: "setReadOnly"; args: { reason: string } }
  | { agent: "DB"; op: string; args: unknown }
  | { agent: "OpusAgent"; op: "takeTurn"; args: { input: PeerTurnInput } }
  | { agent: "GptAgent"; op: "takeTurn"; args: { input: PeerTurnInput } }
  | { agent: "Policy"; op: "decide"; args: { effect: RequestedEffect } }
  | { agent: "EffectsQueue"; op: "seed"; args: { effects: RequestedEffect[] } }
  | { agent: "EffectsQueue"; op: "shift"; args: Record<string, never> }
  | {
      agent: "EffectHandler";
      op: "invoke";
      args: { effectId: string; data: Val };
    };

/**
 * Scripted dispatch result fed to the EffectHandler mock, in the same order
 * as the workflow calls EffectHandler().invoke({effectId, data}).
 */
export type DispatchResult =
  | { ok: true; result: Val }
  | { ok: false; error: { name: string; message: string } };

export interface HarnessOptions {
  /** Initial transcript for DB.loadMessages. */
  initialTranscript?: TurnEntry[];
  /** Initial loop control for App.readControl (mutates on writeControl). */
  initialControl?: LoopControl;
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
   * { kind: "executed" }. Missing entries throw UnknownEffectError.
   */
  dispatchScript?: DispatchResult[];
  /**
   * Turn mutations applied to the internal control state immediately AFTER
   * a peer takeTurn (keyed by turnIndex that just completed). Useful to
   * exercise control-path behavior without driving through the browser.
   */
  controlMutationsAfterTurn?: Record<number, Partial<LoopControl>>;
  /** Hard ceiling on peer turns before the harness halts the workflow. */
  maxTurns?: number;
}

export interface HarnessResult {
  operations: OperationCall[];
  appendedMessages: TurnEntry[];
  appendedPeerRecords: PeerRecord[];
  appendedEffectRequests: EffectRequestRecord[];
  finalControl: LoopControl;
  exitReason?: string;
  terminatedByMaxTurns: boolean;
}

/** Run the compiled peerLoop workflow under the harness. */
export function* runHarness(options: HarnessOptions): Operation<HarnessResult> {
  const operations: OperationCall[] = [];
  const transcript: TurnEntry[] = [...(options.initialTranscript ?? [])];
  let control: LoopControl = {
    ...(options.initialControl ?? { paused: false, stopRequested: false }),
  };
  const peerRecords: PeerRecord[] = [];
  const effectRequests: EffectRequestRecord[] = [];

  const tarasMessages = [...(options.tarasMessages ?? [])];
  const opusScript = [...(options.opusScript ?? [])];
  const gptScript = [...(options.gptScript ?? [])];
  const policyScript = [...(options.policyScript ?? [])];
  const dispatchScript = [...(options.dispatchScript ?? [])];
  const maxTurns = options.maxTurns ?? 20;
  let peerTurnIndex = 0;
  let exitReason: string | undefined;
  let terminatedByMaxTurns = false;

  // Per-cycle queue state — the EffectsQueue mock seeds/shifts this list.
  let queue: RequestedEffect[] = [];

  const done = withResolvers<void>();

  // App agent: Taras messages, transcript hydration, showMessage, readControl, setReadOnly.
  yield* Agents.use(App(), {
    *elicit({ input }) {
      operations.push({ agent: "App", op: "elicit", args: input });
      if (tarasMessages.length === 0) {
        done.resolve();
        throw new Error("TARAS_SCRIPT_EXHAUSTED");
      }
      return { message: tarasMessages.shift()! };
    },
    *showMessage({ input }) {
      operations.push({ agent: "App", op: "showMessage", args: input });
    },
    *loadChat({ input }) {
      operations.push({ agent: "App", op: "loadChat", args: input });
    },
    *readControl() {
      operations.push({ agent: "App", op: "readControl", args: {} });
      return { ...control };
    },
    *setReadOnly({ input }) {
      operations.push({ agent: "App", op: "setReadOnly", args: input });
      exitReason = input.reason;
    },
  });

  // DB agent: in-memory transcript, control, peer records, effect records.
  yield* Agents.use(DB(), {
    *loadMessages() {
      operations.push({ agent: "DB", op: "loadMessages", args: {} });
      return [...transcript];
    },
    *appendMessage({ input }) {
      operations.push({ agent: "DB", op: "appendMessage", args: input });
      transcript.push(input.entry);
    },
    *loadControl() {
      operations.push({ agent: "DB", op: "loadControl", args: {} });
      return { ...control };
    },
    *writeControl({ input }) {
      operations.push({ agent: "DB", op: "writeControl", args: input });
      control = { ...input.control };
    },
    *loadPeerRecords() {
      operations.push({ agent: "DB", op: "loadPeerRecords", args: {} });
      return [...peerRecords];
    },
    *appendPeerRecord({ input }) {
      operations.push({ agent: "DB", op: "appendPeerRecord", args: input });
      peerRecords.push(input.record);
    },
    *loadEffectRequests() {
      operations.push({ agent: "DB", op: "loadEffectRequests", args: {} });
      return [...effectRequests];
    },
    *appendEffectRequest({ input }) {
      operations.push({ agent: "DB", op: "appendEffectRequest", args: input });
      effectRequests.push(input.record);
    },
  });

  // Opus peer.
  yield* Agents.use(OpusAgent(), {
    *takeTurn({ input }) {
      operations.push({
        agent: "OpusAgent",
        op: "takeTurn",
        args: { input: input.input },
      });
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
      const mutation = options.controlMutationsAfterTurn?.[peerTurnIndex];
      if (mutation) {
        control = { ...control, ...mutation };
      }
      return script;
    },
  });

  // Gpt peer.
  yield* Agents.use(GptAgent(), {
    *takeTurn({ input }) {
      operations.push({
        agent: "GptAgent",
        op: "takeTurn",
        args: { input: input.input },
      });
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
      const mutation = options.controlMutationsAfterTurn?.[peerTurnIndex];
      if (mutation) {
        control = { ...control, ...mutation };
      }
      return script;
    },
  });

  // Policy agent — per-effect decisions from the scripted queue.
  yield* Agents.use(Policy(), {
    *decide({ input }) {
      operations.push({
        agent: "Policy",
        op: "decide",
        args: input,
      });
      const next = policyScript.shift();
      if (next !== undefined) {
        return next;
      }
      return { kind: "rejected", reason: "unregistered" };
    },
  });

  // EffectsQueue agent — per-cycle FIFO of requested effects.
  yield* Agents.use(EffectsQueue(), {
    *seed({ input }) {
      operations.push({
        agent: "EffectsQueue",
        op: "seed",
        args: input,
      });
      queue = [...input.effects];
    },
    *shift() {
      operations.push({
        agent: "EffectsQueue",
        op: "shift",
        args: {},
      });
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
    *invoke({ input }) {
      operations.push({
        agent: "EffectHandler",
        op: "invoke",
        args: input,
      });
      const next = dispatchScript.shift();
      if (next === undefined) {
        return {
          ok: false as const,
          error: {
            name: "UnknownEffectError",
            message: `Unknown effect: ${input.effectId}`,
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
  });

  yield* done.operation;
  yield* task.halt();

  const appendedMessages = operations
    .filter((op) => op.agent === "DB" && op.op === "appendMessage")
    .map((op) => (op.args as { entry: TurnEntry }).entry);
  const appendedPeerRecords = operations
    .filter((op) => op.agent === "DB" && op.op === "appendPeerRecord")
    .map((op) => (op.args as { record: PeerRecord }).record);
  const appendedEffectRequests = operations
    .filter((op) => op.agent === "DB" && op.op === "appendEffectRequest")
    .map((op) => (op.args as { record: EffectRequestRecord }).record);

  return {
    operations,
    appendedMessages,
    appendedPeerRecords,
    appendedEffectRequests,
    finalControl: control,
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
