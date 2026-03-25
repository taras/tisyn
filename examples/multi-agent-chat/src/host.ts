/**
 * Multi-Agent Chat Demo — Server Host
 *
 * The host is the sole orchestrator. It:
 * 1. Starts a WebSocket server for the browser
 * 2. Spawns a Worker for the LLM agent
 * 3. Installs a local State agent for history management
 * 4. Installs a local Browser agent backed by a BrowserSessionManager
 * 5. Executes the compiled chat workflow
 *
 * Optional: --journal <path> enables file-backed durable journaling.
 * On restart, the runtime replays stored events and the State agent's
 * history is reconstructed from the journal.
 *
 * Browser disconnect is non-fatal: the workflow stays blocked on
 * waitForUser across disconnects and resumes when the same browser
 * reconnects (identified by clientSessionId from localStorage).
 *
 * One workflow per host process, owned by the first clientSessionId
 * to connect. Non-owner sessions get a read-only transcript view.
 */

import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Browser, chat, Llm, State } from "./workflow.generated.js";
import { useWebSocketServer } from "./browser-transport.js";
import { FileJournalStream } from "./file-journal-stream.js";
import { reconstructHistory } from "./reconstruct-history.js";
import { BrowserSessionManager } from "./browser-session.js";
import type { BrowserToHost } from "./browser-session.js";
import { main, each, spawn, withResolvers } from "effection";
import { logInfo, logError } from "./logger.js";

// Parse CLI args: --journal <path>, --port <number>
let journalPath: string | undefined;
let port = 3000;
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i]!;
  if (arg === "--journal") {
    journalPath = process.argv[i + 1];
    if (!journalPath) {
      console.error("--journal requires a file path");
      process.exit(1);
    }
  } else if (arg.startsWith("--journal=")) {
    journalPath = arg.slice("--journal=".length);
    if (!journalPath) {
      console.error("--journal requires a file path");
      process.exit(1);
    }
  } else if (arg === "--port") {
    const val = process.argv[i + 1];
    if (!val || isNaN(Number(val))) {
      console.error("--port requires a number");
      process.exit(1);
    }
    port = Number(val);
  } else if (arg.startsWith("--port=")) {
    const val = arg.slice("--port=".length);
    if (!val || isNaN(Number(val))) {
      console.error("--port requires a number");
      process.exit(1);
    }
    port = Number(val);
  }
}

await main(function* () {
  const stream = journalPath ? new FileJournalStream(journalPath) : new InMemoryStream();

  // --- Startup history reconstruction (once, no browser) ---
  const history: Array<{ role: string; content: string }> = [];
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

  // --- Persistent agents ---
  const llmTransport = workerTransport({
    url: import.meta.resolve("./llm-worker.ts"),
  });

  yield* installRemoteAgent(Llm(), llmTransport);
  logInfo("host", "LLM worker agent installed");

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

  // --- Browser session manager ---
  const session = new BrowserSessionManager(history);

  const browserImpl = implementAgent(Browser(), {
    *waitForUser({ input }) {
      return yield* session.waitForUser(input.prompt);
    },
    *showAssistantMessage({ input }) {
      session.showAssistantMessage(input.message);
    },
    *hydrateTranscript() {
      // No-op — hydration is handled by session.attach()
    },
    *setReadOnly({ input }) {
      session.setReadOnly(input.reason);
    },
  });

  yield* browserImpl.install();
  logInfo("host", "browser agent installed (local, reconnectable)");

  // --- WebSocket server ---
  const connections = yield* useWebSocketServer(port);

  // Connection loop in background: attach/detach sockets
  yield* spawn(function* () {
    for (const connection of yield* each(connections)) {
      yield* spawn(function* () {
        const ws = yield* connection;
        logInfo("host", "WebSocket connected, waiting for connect message");

        // Wait for the first message (must be a connect)
        const firstMsg = yield* waitForFirstMessage(ws);
        if (firstMsg.type === "connect") {
          session.attach(firstMsg.clientSessionId, ws);
        } else {
          logInfo("host", "first message was not connect, closing");
          ws.close();
          return;
        }

        // Block until socket closes — useConnection resource closes ws on scope exit
        // detach happens via the close listener set up in attach()
        const closed = withResolvers<void>();
        ws.on("close", () => closed.resolve());
        yield* closed.operation;
      });
      yield* each.next();
    }
  });

  // --- Wait for owner, then start workflow ---
  yield* session.waitForOwner();
  logInfo("host", "owner session connected, starting workflow");

  // Workflow in a spawned task — host stays alive after it ends
  yield* spawn(function* () {
    const { result } = yield* execute({ ir: Call(chat), stream });
    if (result.status === "ok") {
      session.setReadOnly("Session complete");
      logInfo("host", "workflow completed");
    } else {
      session.setReadOnly("Session ended");
      logError("host", "workflow failed", result.status === "err" ? result.error : "cancelled");
    }
  });

  // Block forever — host exits only on CTRL+C
  yield* withResolvers<void>().operation;
});

// --- Helpers ---

function waitForFirstMessage(ws: import("ws").WebSocket): import("effection").Operation<BrowserToHost> {
  const { operation, resolve } = withResolvers<BrowserToHost>();
  const handler = (data: import("ws").RawData) => {
    ws.off("message", handler);
    resolve(JSON.parse(data.toString()));
  };
  ws.on("message", handler);
  return operation;
}
