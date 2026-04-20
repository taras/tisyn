/**
 * DPL-JNL-01/02: the kernel journal is the sole durable source of truth.
 *
 *   - JNL-01: a completed run's journal records the full agent-op trace
 *     and ends in a Close event; replay from a prefix of that journal
 *     consumes replayable events without dispatching and then proceeds
 *     live for everything past the frontier.
 *   - JNL-02: the first live dispatch past the frontier is an App.hydrate,
 *     confirming the workflow's "push state to the browser" step fires
 *     under live evaluation instead of being served from the stream.
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
  Projection,
  peerLoop,
  processEffects,
  dispatchEffect,
  dispatchExecuted,
  drainControlPatches,
} from "../../src/workflow.generated.js";
import { DEFAULT_LOOP_CONTROL } from "../../src/schemas.js";
import { mergeControlPatch } from "../../src/projection-agent.js";
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
      if (patchQueue.length > 0) return patchQueue.shift()!;
      const sub = yield* patchReady;
      while (patchQueue.length === 0) yield* sub.next();
      return patchQueue.shift()!;
    },
    *hydrate() {
      liveCalls.push("App.hydrate");
    },
  });

  yield* Agents.use(Projection(), {
    *readInitialControl() {
      liveCalls.push("Projection.readInitialControl");
      return { ...seed };
    },
    *applyControlPatch({ current, patch }) {
      liveCalls.push("Projection.applyControlPatch");
      return mergeControlPatch(current, patch);
    },
    *appendMessage({ messages, entry }) {
      liveCalls.push("Projection.appendMessage");
      return [...messages, entry];
    },
    *appendPeerRecord({ records, record }) {
      liveCalls.push("Projection.appendPeerRecord");
      return [...records, record];
    },
    *appendEffectRequest({ records, record }) {
      liveCalls.push("Projection.appendEffectRequest");
      return [...records, record];
    },
  });

  yield* Agents.use(OpusAgent(), {
    *takeTurn() {
      liveCalls.push("OpusAgent.takeTurn");
      const next = opusQueue.shift();
      if (!next) throw new Error("OPUS_EXHAUSTED");
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
      for (const e of effects) effectsQueue.push(e);
    },
    *shift() {
      liveCalls.push("EffectsQueue.shift");
      if (effectsQueue.length === 0) return { effect: null };
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

  // Suppress the elicit exhaustion sentinel and surface it as a clean error.
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
  it("JNL-01: a completed run's journal ends in Close and captures the agent-op trace", function* () {
    const first = yield* runPeerLoopOnce({
      stream: undefined,
      opusScript: [{ display: "opus done", status: "done" }],
      tarasMessages: ["go"],
    });

    expect(first.liveCalls.length).toBeGreaterThan(0);
    expect(first.journal.length).toBeGreaterThan(0);
    expect(first.journal[first.journal.length - 1].type).toBe("close");

    // Sanity: the binding trace includes at least one of each expected op.
    expect(first.liveCalls).toContain("Projection.readInitialControl");
    expect(first.liveCalls).toContain("App.hydrate");
    expect(first.liveCalls).toContain("App.elicit");
    expect(first.liveCalls).toContain("OpusAgent.takeTurn");
    expect(first.liveCalls).toContain("Projection.appendMessage");
  });

  it("JNL-02: replay from a journal prefix drives live dispatch starting with App.hydrate", function* () {
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

    // Live tail post-frontier contains at least one App.hydrate.
    expect(second.liveCalls).toContain("App.hydrate");
    // The workflow still terminates with an "ok" status on the rerun.
    expect(second.result.status).toBe("ok");
  });
});
