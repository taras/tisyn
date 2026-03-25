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
 *
 * The host accepts one browser connection at a time. On each connection,
 * the browser transcript is hydrated from current host history. The
 * workflow executes only on the first connection; after it ends (for any
 * reason), subsequent connections receive hydration only (read-only view).
 */

import { implementAgent, invoke } from "@tisyn/agent";
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
import { main, scoped, each, spawn } from "effection";
import type { WebSocket } from "ws";
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

  // --- Persistent agents (survive reconnects) ---
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
        { role: "assistant", content: input.assistantMessage }
      );
      logInfo("state", "history updated", { length: history.length });
    },
  });

  yield* stateImpl.install();
  logInfo("host", "state agent installed");

  // --- WebSocket server (persistent) ---
  const connections = yield* useWebSocketServer();

  // --- Connection loop (single browser at a time) ---
  // Mutable across scoped() callbacks — TypeScript can't track mutations
  // inside generator callbacks, so we type broadly to avoid false narrowing.
  let sessionStatus = "pending" as
    | "pending"
    | "executing"
    | "completed"
    | "failed";

  let task = yield* spawn(function* () {});
  for (const connection of yield* each(connections)) {
    yield* task.halt();
    task = yield* spawn(() =>
      scoped(function* () {
        // Yield the connection resource — WebSocket is closed when scope exits
        const browserWs = yield* connection;

        logInfo("host", "browser connected");

        try {
          yield* installRemoteAgent(
            Browser(),
            serverWebSocketTransport(browserWs)
          );
          logInfo("host", "browser agent installed");

          // --- Per-connection transcript hydration ---
          if (history.length > 0) {
            yield* invoke(
              Browser().hydrateTranscript({ input: { messages: history } })
            );
            logInfo("host", "browser transcript hydrated", {
              messages: history.length,
            });
          }

          if (sessionStatus === "pending") {
            // Mark that execute() is now active — disconnect from this
            // point forward permanently ends the session.
            sessionStatus = "executing";
            logInfo("host", "starting chat workflow");
            const { result } = yield* execute({ ir: Call(chat), stream });
            if (result.status === "ok") {
              sessionStatus = "completed";
              logInfo("host", "workflow completed");
            } else {
              // Both "err" and "cancelled" are treated as failed
              sessionStatus = "failed";
              logError(
                "host",
                "workflow failed",
                result.status === "err" ? result.error : "cancelled"
              );
              if (result.status === "err") {
                try {
                  // Browser may still be connected (error from journal replay, not transport failure)
                  yield* invoke(
                    Browser().setReadOnly({
                      input: { reason: "Session ended" },
                    })
                  );
                } catch {
                  // Browser already disconnected — setReadOnly is moot
                }
              }
            }
          } else if (
            sessionStatus === "completed" ||
            sessionStatus === "failed"
          ) {
            logInfo(
              "host",
              `workflow already ${sessionStatus} — browser shows read-only transcript`
            );
            yield* invoke(
              Browser().setReadOnly({ input: { reason: "Session ended" } })
            );
          }
        } catch (e) {
          if (sessionStatus === "executing") {
            // Disconnect during active execute() — workflow is permanently ended
            sessionStatus = "failed";
            logInfo(
              "host",
              "browser disconnected during workflow, session failed — waiting for reconnect"
            );
          } else if (sessionStatus === "pending") {
            // Disconnect before execute() started (during install or hydration)
            // Session stays pending — next connection can still start the workflow
            logInfo(
              "host",
              "browser disconnected before workflow started — waiting for reconnect"
            );
          } else {
            // Disconnect during read-only hydration view — no state change
            logInfo("host", "browser disconnected — waiting for reconnect");
          }
        }
      })
    );
    yield* each.next();
  }
});
