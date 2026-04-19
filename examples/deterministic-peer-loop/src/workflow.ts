import type { Workflow } from "@tisyn/agent";
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";
import type {
  EffectRequestRecord,
  LoopControl,
  PeerRecord,
  PeerSpeaker,
  PeerTurnInput,
  PeerTurnResult,
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
  appendEffectRequests(input: { records: EffectRequestRecord[] }): Workflow<void>;
};

declare function OpusAgent(): {
  takeTurn(input: { input: PeerTurnInput }): Workflow<PeerTurnResult>;
};

declare function GptAgent(): {
  takeTurn(input: { input: PeerTurnInput }): Workflow<PeerTurnResult>;
};

declare function EffectsProcessor(): {
  processAll(input: {
    effects: RequestedEffect[];
    turnIndex: number;
    requestor: PeerSpeaker;
  }): Workflow<EffectRequestRecord[]>;
};

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
          ? yield* OpusAgent().takeTurn({ input: peerInput })
          : yield* GptAgent().takeTurn({ input: peerInput });
      turnCount = turnCount + 1;

      // Step 6: persist peer turn.
      const peerEntry: TurnEntry = {
        speaker,
        content: result.display,
        usage: result.usage,
      };
      yield* DB().appendMessage({ entry: peerEntry });
      yield* App().showMessage({ entry: peerEntry });
      const peerRecord: PeerRecord = {
        turnIndex: turnCount,
        speaker,
        status: result.status,
        data: result.data,
      };
      yield* DB().appendPeerRecord({ record: peerRecord });

      // Step 7: effect disposition (§6.12).
      const requestedEffects: RequestedEffect[] = result.requestedEffects
        ? result.requestedEffects
        : [];
      const effectRecords = yield* EffectsProcessor().processAll({
        effects: requestedEffects,
        turnIndex: turnCount,
        requestor: speaker,
      });
      yield* DB().appendEffectRequests({ records: effectRecords });

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
    agent("effects-processor", transport.inprocess("./effects/processor-binding.ts")),
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
