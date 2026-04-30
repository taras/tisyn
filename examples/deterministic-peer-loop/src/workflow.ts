import type { Workflow } from "@tisyn/agent";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";
import type {
  BrowserControlPatch,
  InvokeOutcome,
  PeerRecord,
  PeerSpeaker,
  PeerTurnInput,
  PeerTurnResult,
  PolicyDecision,
  RequestedEffect,
  TurnEntry,
} from "./types.js";
import type { AppState, TransitionProposal } from "./state-types.js";
import type { Val } from "@tisyn/ir";

// -- Declared agent contracts (compiler-recognized) --

declare function App(): {
  elicit(input: { message: string }): Workflow<{ message: string }>;
  nextControlPatch(input: Record<string, never>): Workflow<BrowserControlPatch>;
};

declare function StateAgent(): {
  readInitialState(input: Record<string, never>): Workflow<AppState>;
  transition(input: TransitionProposal): Workflow<AppState>;
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
  _state: AppState,
): Workflow<AppState> {
  const outcome = yield* EffectHandler().invoke({
    effectId: effect.id,
    data: effect.input,
  });
  if (outcome.ok) {
    const record: AppState["effectRequests"][number] = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "executed",
      dispositionAt: turnCount,
      result: outcome.result,
    };
    const accepted = yield* StateAgent().transition({ tag: "append-effect-request", record });
    return accepted;
  } else {
    const record: AppState["effectRequests"][number] = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "executed",
      dispositionAt: turnCount,
      error: outcome.error,
    };
    const accepted = yield* StateAgent().transition({ tag: "append-effect-request", record });
    return accepted;
  }
}

export function* dispatchEffect(
  effect: RequestedEffect,
  turnCount: number,
  speaker: "opus" | "gpt",
  state: AppState,
): Workflow<AppState> {
  const decision = yield* Policy().decide({ effect });

  if (decision.kind === "executed") {
    const next = yield* dispatchExecuted(effect, turnCount, speaker, state);
    return next;
  } else if (decision.kind === "deferred") {
    const record: AppState["effectRequests"][number] = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "deferred",
      dispositionAt: turnCount,
    };
    const accepted = yield* StateAgent().transition({ tag: "append-effect-request", record });
    return accepted;
  } else if (decision.kind === "rejected") {
    const record: AppState["effectRequests"][number] = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "rejected",
      dispositionAt: turnCount,
      error: { name: "PolicyRejected", message: decision.reason },
    };
    const accepted = yield* StateAgent().transition({ tag: "append-effect-request", record });
    return accepted;
  } else {
    const record: AppState["effectRequests"][number] = {
      turnIndex: turnCount,
      requestor: speaker,
      effect,
      disposition: "surfaced_to_taras",
      dispositionAt: turnCount,
    };
    const accepted = yield* StateAgent().transition({ tag: "append-effect-request", record });
    return accepted;
  }
}

// -- Sub-workflow: non-blockingly drain buffered control patches from App --

export function* drainControlPatches(state: AppState): Workflow<AppState> {
  let current: AppState = state;
  let draining = true;
  while (draining) {
    const pulled = yield* timebox(0, function* () {
      const patch = yield* App().nextControlPatch({});
      return patch;
    });
    if (pulled.status === "completed") {
      const accepted = yield* StateAgent().transition({
        tag: "apply-control-patch",
        patch: pulled.value,
      });
      current = accepted;
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
  state: AppState,
): Workflow<AppState> {
  yield* EffectsQueue().seed({ effects });

  let current: AppState = state;
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

export function* peerLoop(): Workflow<AppState> {
  let state: AppState = yield* StateAgent().readInitialState({});
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
      const accepted = yield* StateAgent().transition({ tag: "append-message", entry });
      state = accepted;
    }

    // Step 2: drain buffered control patches non-blockingly. Every patch the
    // browser sent during this iteration (including during the Taras gate) is
    // folded into `state.control` before any control-sensitive check.
    state = yield* drainControlPatches(state);

    // Step 3: stop check.
    if (state.control.stopRequested) {
      const accepted = yield* StateAgent().transition({
        tag: "set-read-only",
        reason: "stopped",
      });
      state = accepted;
      return state;
    }

    // Step 4: paused check.
    if (state.control.paused) {
      tarasMode = "optional";
    } else {
      // Step 5: speaker selection (consume one-shot override).
      let speaker: PeerSpeaker = nextSpeaker;
      if (state.control.nextSpeakerOverride) {
        speaker = state.control.nextSpeakerOverride;
        const accepted = yield* StateAgent().transition({
          tag: "apply-control-patch",
          patch: { nextSpeakerOverride: null },
        });
        state = accepted;
      }

      // Step 6: peer step.
      const peerInput: PeerTurnInput = { transcript: state.messages, tarasMode };
      const result: PeerTurnResult =
        speaker === "opus"
          ? yield* OpusAgent().takeTurn(peerInput)
          : yield* GptAgent().takeTurn(peerInput);
      turnCount = turnCount + 1;

      // Step 7: persist peer turn. Only include `usage` when the peer supplied
      // one — store validation rejects a present-but-undefined field.
      const peerEntry: TurnEntry = result.usage
        ? { speaker, content: result.display, usage: result.usage }
        : { speaker, content: result.display };
      const messageAccepted = yield* StateAgent().transition({
        tag: "append-message",
        entry: peerEntry,
      });
      state = messageAccepted;
      const peerRecord: PeerRecord = {
        turnIndex: turnCount,
        speaker,
        status: result.status,
        data: result.data,
      };
      const peerAccepted = yield* StateAgent().transition({
        tag: "append-peer-record",
        record: peerRecord,
      });
      state = peerAccepted;

      // Step 8: per-effect disposition via helper agents (§6.12).
      const requestedEffects: RequestedEffect[] = result.requestedEffects
        ? result.requestedEffects
        : [];
      state = yield* processEffects(requestedEffects, turnCount, speaker, state);

      // Step 9: done handling before recurse.
      if (result.status === "done") {
        const accepted = yield* StateAgent().transition({
          tag: "set-read-only",
          reason: "done",
        });
        state = accepted;
        return state;
      }

      // Step 10: update recursive state.
      tarasMode = result.status === "needs_taras" ? "required" : "optional";
      nextSpeaker = speaker === "opus" ? "gpt" : "opus";
    }
  }
}

export const workflowDescriptor = workflow({
  run: { export: "peerLoop", module: "./workflow.ts" },
  agents: [
    agent("app", transport.local("./browser-agent.ts")),
    agent("state-agent", transport.inprocess("./state-binding.ts")),
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
