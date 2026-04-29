import type { Workflow } from "@tisyn/agent";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";
import type {
  BrowserControlPatch,
  EffectRequestRecord,
  InvokeOutcome,
  LoopControl,
  PeerRecord,
  PeerSpeaker,
  PeerTurnInput,
  PeerTurnResult,
  PolicyDecision,
  RequestedEffect,
  TurnEntry,
} from "./types.js";
import type { Val } from "@tisyn/ir";

// -- Declared agent contracts (compiler-recognized) --

declare function App(): {
  elicit(input: { message: string }): Workflow<{ message: string }>;
  nextControlPatch(input: Record<string, never>): Workflow<BrowserControlPatch>;
  hydrate(input: {
    messages: TurnEntry[];
    control: LoopControl;
    readOnlyReason: string | null;
  }): Workflow<void>;
};

declare function Projection(): {
  readInitialControl(input: Record<string, never>): Workflow<LoopControl>;
  applyControlPatch(input: {
    current: LoopControl;
    patch: BrowserControlPatch;
  }): Workflow<LoopControl>;
  appendMessage(input: { messages: TurnEntry[]; entry: TurnEntry }): Workflow<TurnEntry[]>;
  appendPeerRecord(input: { records: PeerRecord[]; record: PeerRecord }): Workflow<PeerRecord[]>;
  appendEffectRequest(input: {
    records: EffectRequestRecord[];
    record: EffectRequestRecord;
  }): Workflow<EffectRequestRecord[]>;
};

declare function OpusAgent(): {
  takeTurn(input: PeerTurnInput): Workflow<PeerTurnResult>;
};

declare function GptAgent(): {
  takeTurn(input: PeerTurnInput): Workflow<PeerTurnResult>;
};

declare function Policy(): {
  decide(input: { effect: RequestedEffect }): Workflow<PolicyDecision>;
};

declare function EffectsQueue(): {
  seed(input: { effects: RequestedEffect[] }): Workflow<void>;
  shift(input: Record<string, never>): Workflow<{ effect: RequestedEffect | null }>;
};

declare function EffectHandler(): {
  invoke(input: { effectId: string; data: Val }): Workflow<InvokeOutcome>;
};

// -- Sub-workflow: dispatch a single effect (executed branch) --

export function* dispatchExecuted(
  effect: RequestedEffect,
  turnCount: number,
  speaker: "opus" | "gpt",
  records: EffectRequestRecord[],
): Workflow<EffectRequestRecord[]> {
  const outcome = yield* EffectHandler().invoke({
    effectId: effect.id,
    data: effect.input,
  });
  if (outcome.ok) {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "executed",
      dispositionAt: turnCount,
      result: outcome.result,
    };
    const appended = yield* Projection().appendEffectRequest({ records, record });
    return appended;
  } else {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "executed",
      dispositionAt: turnCount,
      error: outcome.error,
    };
    const appended = yield* Projection().appendEffectRequest({ records, record });
    return appended;
  }
}

export function* dispatchEffect(
  effect: RequestedEffect,
  turnCount: number,
  speaker: "opus" | "gpt",
  records: EffectRequestRecord[],
): Workflow<EffectRequestRecord[]> {
  const decision = yield* Policy().decide({ effect });

  if (decision.kind === "executed") {
    const next = yield* dispatchExecuted(effect, turnCount, speaker, records);
    return next;
  } else if (decision.kind === "deferred") {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "deferred",
      dispositionAt: turnCount,
    };
    const appended = yield* Projection().appendEffectRequest({ records, record });
    return appended;
  } else if (decision.kind === "rejected") {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "rejected",
      dispositionAt: turnCount,
      error: { name: "PolicyRejected", message: decision.reason },
    };
    const appended = yield* Projection().appendEffectRequest({ records, record });
    return appended;
  } else {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "surfaced_to_taras",
      dispositionAt: turnCount,
    };
    const appended = yield* Projection().appendEffectRequest({ records, record });
    return appended;
  }
}

// -- Sub-workflow: non-blockingly drain buffered control patches from App --

export function* drainControlPatches(control: LoopControl): Workflow<LoopControl> {
  let current: LoopControl = control;
  let draining = true;
  while (draining) {
    const pulled = yield* timebox(0, function* () {
      const patch = yield* App().nextControlPatch({});
      return patch;
    });
    if (pulled.status === "completed") {
      current = yield* Projection().applyControlPatch({
        current,
        patch: pulled.value,
      });
    } else {
      draining = false;
    }
  }
  return current;
}

// -- Sub-workflow: per-effect drain of EffectsQueue (§6.12) --

export function* processEffects(
  effects: RequestedEffect[],
  turnCount: number,
  speaker: "opus" | "gpt",
  records: EffectRequestRecord[],
): Workflow<EffectRequestRecord[]> {
  yield* EffectsQueue().seed({ effects });

  let current: EffectRequestRecord[] = records;
  let draining = true;
  while (draining) {
    const head = yield* EffectsQueue().shift({});
    if (head.effect === null) {
      draining = false;
    } else {
      const next = yield* dispatchEffect(head.effect, turnCount, speaker, current);
      current = next;
    }
  }
  return current;
}

// -- Workflow body (§7.2 cycle with recursive state in a while-loop) --

export function* peerLoop(): Workflow<{
  messages: TurnEntry[];
  control: LoopControl;
  readOnlyReason: string | null;
}> {
  let messages: TurnEntry[] = [];
  let control: LoopControl = yield* Projection().readInitialControl({});
  let peerRecords: PeerRecord[] = [];
  let effectRequests: EffectRequestRecord[] = [];
  let readOnlyReason: string | null = null;
  let nextSpeaker: PeerSpeaker = "opus";
  let tarasMode: "optional" | "required" = "optional";
  let turnCount = 0;

  while (true) {
    // Step 1: hydrate browser mirror with current workflow-owned state.
    yield* App().hydrate({ messages, control, readOnlyReason });

    // Step 2: Taras gate.
    let tarasMessage: string | null = null;
    if (tarasMode === "required") {
      const elicited = yield* App().elicit({
        message: "Your input is required before the next peer step.",
      });
      tarasMessage = elicited.message;
    } else {
      const result = yield* timebox(180000, function* () {
        const elicited = yield* App().elicit({
          message: "Optional — you may let the peers proceed.",
        });
        return elicited.message;
      });
      if (result.status === "completed") {
        tarasMessage = result.value;
      } else {
        tarasMessage = null;
      }
    }

    if (tarasMessage !== null) {
      const entry: TurnEntry = { speaker: "taras", content: tarasMessage };
      messages = yield* Projection().appendMessage({ messages, entry });
    }

    // Step 3: drain buffered control patches non-blockingly. Every patch the
    // browser sent during this iteration (including during the Taras gate) is
    // folded into `control` before any control-sensitive check.
    control = yield* drainControlPatches(control);

    // Step 4: stop check.
    if (control.stopRequested) {
      readOnlyReason = "stopped";
      yield* App().hydrate({ messages, control, readOnlyReason });
      return { messages, control, readOnlyReason };
    }

    // Step 5: paused check.
    if (control.paused) {
      tarasMode = "optional";
    } else {
      // Step 6: speaker selection (consume one-shot override).
      let speaker: PeerSpeaker = nextSpeaker;
      if (control.nextSpeakerOverride) {
        speaker = control.nextSpeakerOverride;
        control = yield* Projection().applyControlPatch({
          current: control,
          patch: { nextSpeakerOverride: null },
        });
      }

      // Step 7: peer step.
      const peerInput: PeerTurnInput = { transcript: messages, tarasMode };
      const result: PeerTurnResult =
        speaker === "opus"
          ? yield* OpusAgent().takeTurn(peerInput)
          : yield* GptAgent().takeTurn(peerInput);
      turnCount = turnCount + 1;

      // Step 8: persist peer turn. Only include `usage` when the peer supplied
      // one — store validation rejects a present-but-undefined field.
      const peerEntry: TurnEntry = result.usage
        ? { speaker, content: result.display, usage: result.usage }
        : { speaker, content: result.display };
      messages = yield* Projection().appendMessage({ messages, entry: peerEntry });
      const peerRecord: PeerRecord = {
        turnIndex: turnCount,
        speaker,
        status: result.status,
        data: result.data,
      };
      peerRecords = yield* Projection().appendPeerRecord({
        records: peerRecords,
        record: peerRecord,
      });

      // Step 9: per-effect disposition via helper agents (§6.12).
      const requestedEffects: RequestedEffect[] = result.requestedEffects
        ? result.requestedEffects
        : [];
      const nextEffectRequests = yield* processEffects(
        requestedEffects,
        turnCount,
        speaker,
        effectRequests,
      );
      effectRequests = nextEffectRequests;

      // Step 10: done handling before recurse.
      if (result.status === "done") {
        readOnlyReason = "done";
        yield* App().hydrate({ messages, control, readOnlyReason });
        return { messages, control, readOnlyReason };
      }

      // Step 11: update recursive state.
      tarasMode = result.status === "needs_taras" ? "required" : "optional";
      nextSpeaker = speaker === "opus" ? "gpt" : "opus";
    }
  }
}

export const workflowDescriptor = workflow({
  run: { export: "peerLoop", module: "./workflow.ts" },
  agents: [
    agent("app", transport.local("./browser-agent.ts")),
    agent("projection", transport.inprocess("./projection-agent.ts")),
    agent("opus-agent", transport.inprocess("./peers/opus-binding.ts")),
    agent("gpt-agent", transport.inprocess("./peers/gpt-binding.ts")),
    agent("effects-policy", transport.inprocess("./effects/policy-binding.ts")),
    agent("effects-queue", transport.inprocess("./effects/queue-binding.ts")),
    agent("effect-handler", transport.inprocess("./effects/handler-binding.ts")),
  ],
  journal: journal.file(env("JOURNAL_PATH", "./data/peer-loop.ndjson")),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({
        port: env("PORT", 3000),
        static: "../browser/dist",
      }),
    }),
  },
});

export default workflowDescriptor;
