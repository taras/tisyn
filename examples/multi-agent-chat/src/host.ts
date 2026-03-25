/**
 * Multi-Agent Chat Demo — Server Host
 *
 * The host is the sole orchestrator. It:
 * 1. Starts a WebSocket server for the browser agent
 * 2. Spawns a Worker for the LLM agent
 * 3. Installs a local State agent for history management
 * 4. Executes the compiled chat workflow
 *
 * Optional: --journal <path> enables file-backed durable journaling.
 * On restart, the runtime replays stored events and the State agent's
 * history is reconstructed from the journal.
 */

import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Browser, chat, Llm, State } from "./workflow.generated.js";
import {
  serverWebSocketTransport,
  useWebSocketServer,
} from "./browser-transport.js";
import { FileJournalStream } from "./file-journal-stream.js";
import { reconstructHistory } from "./reconstruct-history.js";
import { main } from "effection";
import { logInfo, logError } from "./logger.js";

// Parse --journal <path> or --journal=<path> from CLI args
let journalPath: string | undefined;
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (arg === "--journal") {
    journalPath = process.argv[i + 1];
    if (!journalPath) {
      console.error("--journal requires a file path");
      process.exit(1);
    }
    break;
  }
  if (arg.startsWith("--journal=")) {
    journalPath = arg.slice("--journal=".length);
    if (!journalPath) {
      console.error("--journal requires a file path");
      process.exit(1);
    }
    break;
  }
}

await main(function* () {
  const stream = journalPath
    ? new FileJournalStream(journalPath)
    : new InMemoryStream();

  const browserWs = yield* useWebSocketServer();

  yield* installRemoteAgent(Browser(), serverWebSocketTransport(browserWs));
  logInfo("host", "browser agent installed");

  const llmTransport = workerTransport({
    url: import.meta.resolve("./llm-worker.ts"),
  });

  yield* installRemoteAgent(Llm(), llmTransport);
  logInfo("host", "LLM worker agent installed");

  const history: Array<{ role: string; content: string }> = [];

  // Reconstruct history from journal if resuming
  if (journalPath) {
    const stored = yield* stream.readAll();
    const restored = reconstructHistory(stored);
    history.push(...restored);
    logInfo("host", "journal loaded", {
      path: journalPath,
      events: stored.length,
      turns: restored.length / 2,
    });
  }

  const stateImpl = implementAgent(State(), {
    *getHistory() {
      logInfo("state", "getHistory", { length: history.length });
      return [...history];
    },
    *recordTurn({ input }) {
      logInfo("state", "recordTurn", {
        user: input.userMessage,
        assistant: input.assistantMessage,
      });
      history.push(
        { role: "user", content: input.userMessage },
        { role: "assistant", content: input.assistantMessage },
      );
      logInfo("state", "history updated", { length: history.length });
    },
  });

  yield* stateImpl.install();
  logInfo("host", "state agent installed");

  logInfo("host", "starting chat workflow");
  const { result } = yield* execute({ ir: Call(chat), stream });
  if (result.status === "err") {
    logError("host", "workflow failed", result.error);
  } else {
    logInfo("host", "workflow completed", { status: result.status });
  }
});
