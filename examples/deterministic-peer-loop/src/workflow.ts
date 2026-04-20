import type { Workflow } from "@tisyn/agent";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";
import type {
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
  showMessage(input: { entry: TurnEntry }): Workflow<void>;
  readControl(input: Record<string, never>): Workflow<LoopControl>;
  loadChat(input: { messages: TurnEntry[] }): Workflow<void>;
  setReadOnly(input: { reason: string }): Workflow<void>;
};

declare function DB(): {
  loadMessages(input: Record<string, never>): Workflow<TurnEntry[]>;
  appendMessage(input: { entry: TurnEntry }): Workflow<void>;
  loadControl(input: Record<string, never>): Workflow<LoopControl>;
  writeControl(input: { control: LoopControl }): Workflow<void>;
  loadPeerRecords(input: Record<string, never>): Workflow<PeerRecord[]>;
  appendPeerRecord(input: { record: PeerRecord }): Workflow<void>;
  loadEffectRequests(input: Record<string, never>): Workflow<EffectRequestRecord[]>;
  appendEffectRequest(input: { record: EffectRequestRecord }): Workflow<void>;
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

// -- Sub-workflow: dispatch a single effect (executed branch uses try/catch) --

export function* dispatchExecuted(
  effect: RequestedEffect,
  turnCount: number,
  speaker: "opus" | "gpt",
): Workflow<void> {
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
    yield* DB().appendEffectRequest({ record });
  } else {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "executed",
      dispositionAt: turnCount,
      error: outcome.error,
    };
    yield* DB().appendEffectRequest({ record });
  }
}

export function* dispatchEffect(
  effect: RequestedEffect,
  turnCount: number,
  speaker: "opus" | "gpt",
): Workflow<void> {
  const decision = yield* Policy().decide({ effect });

  if (decision.kind === "executed") {
    yield* dispatchExecuted(effect, turnCount, speaker);
  } else if (decision.kind === "deferred") {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "deferred",
      dispositionAt: turnCount,
    };
    yield* DB().appendEffectRequest({ record });
  } else if (decision.kind === "rejected") {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "rejected",
      dispositionAt: turnCount,
      error: { name: "PolicyRejected", message: decision.reason },
    };
    yield* DB().appendEffectRequest({ record });
  } else {
    const record: EffectRequestRecord = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "surfaced_to_taras",
      dispositionAt: turnCount,
    };
    yield* DB().appendEffectRequest({ record });
  }
}

// -- Sub-workflow: per-effect drain of EffectsQueue (§6.12) --

export function* processEffects(
  effects: RequestedEffect[],
  turnCount: number,
  speaker: "opus" | "gpt",
): Workflow<void> {
  yield* EffectsQueue().seed({ effects });

  let draining = true;
  while (draining) {
    const head = yield* EffectsQueue().shift({});
    if (head.effect === null) {
      draining = false;
    } else {
      yield* dispatchEffect(head.effect, turnCount, speaker);
    }
  }
}

// -- Workflow body (§7.2 cycle with recursive state in a while-loop) --

export function* peerLoop(): Workflow<void> {
  // LOOP-INIT-1: warm-start — hydrate browser from DB.
  const priorMessages = yield* DB().loadMessages({});
  yield* App().loadChat({ messages: priorMessages });

  let nextSpeaker: PeerSpeaker = "opus";
  let tarasMode: "optional" | "required" = "optional";
  let turnCount = 0;

  while (true) {
    // Step 1: Taras gate.
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
      yield* DB().appendMessage({ entry });
      yield* App().showMessage({ entry });
    }

    // Step 2: in-cycle control read.
    const control = yield* App().readControl({});

    // Step 3: stop check before pause check.
    if (control.stopRequested) {
      yield* App().setReadOnly({ reason: "stopped" });
      return;
    }

    if (control.paused) {
      tarasMode = "optional";
    } else {
      // Step 4: speaker selection (override one-shot).
      let speaker: PeerSpeaker = nextSpeaker;
      if (control.nextSpeakerOverride) {
        speaker = control.nextSpeakerOverride;
        const cleared: LoopControl = {
          paused: control.paused,
          stopRequested: control.stopRequested,
        };
        yield* DB().writeControl({ control: cleared });
      }

      // Step 5: peer step.
      const transcript = yield* DB().loadMessages({});
      const peerInput: PeerTurnInput = { transcript, tarasMode };
      const result: PeerTurnResult =
        speaker === "opus"
          ? yield* OpusAgent().takeTurn(peerInput)
          : yield* GptAgent().takeTurn(peerInput);
      turnCount = turnCount + 1;

      // Step 6: persist peer turn. Only include `usage` when the peer supplied
      // one — store validation rejects a present-but-undefined field.
      const peerEntry: TurnEntry = result.usage
        ? { speaker, content: result.display, usage: result.usage }
        : { speaker, content: result.display };
      yield* DB().appendMessage({ entry: peerEntry });
      yield* App().showMessage({ entry: peerEntry });
      const peerRecord: PeerRecord = {
        turnIndex: turnCount,
        speaker,
        status: result.status,
        data: result.data,
      };
      yield* DB().appendPeerRecord({ record: peerRecord });

      // Step 7: per-effect disposition via helper agents (§6.12).
      const requestedEffects: RequestedEffect[] = result.requestedEffects
        ? result.requestedEffects
        : [];
      yield* processEffects(requestedEffects, turnCount, speaker);

      // Step 8: done handling before recurse.
      if (result.status === "done") {
        yield* App().setReadOnly({ reason: "done" });
        return;
      }

      // Step 9: update recursive state.
      tarasMode = result.status === "needs_taras" ? "required" : "optional";
      nextSpeaker = speaker === "opus" ? "gpt" : "opus";
    }
  }
}

export default workflow({
  run: { export: "peerLoop", module: "./workflow.ts" },
  agents: [
    agent("app", transport.local("./browser-agent.ts"), {
      dbPath: env("PEER_LOOP_DB_PATH", "./data/peer-loop.json"),
    }),
    agent("d-b", transport.inprocess("./db-agent.ts"), {
      dbPath: env("PEER_LOOP_DB_PATH", "./data/peer-loop.json"),
    }),
    agent("opus-agent", transport.inprocess("./peers/opus-binding.ts")),
    agent("gpt-agent", transport.inprocess("./peers/gpt-binding.ts")),
    agent("effects-policy", transport.inprocess("./effects/policy-binding.ts")),
    agent("effects-queue", transport.inprocess("./effects/queue-binding.ts")),
    agent("effect-handler", transport.inprocess("./effects/handler-binding.ts")),
  ],
  journal: journal.memory(),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({
        port: env("PORT", 3000),
        static: "../browser/dist",
      }),
    }),
  },
});
