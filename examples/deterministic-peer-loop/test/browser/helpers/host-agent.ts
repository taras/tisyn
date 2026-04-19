import { type Operation, type Task, spawn, race, sleep, withResolvers } from "effection";
import { daemon, type Daemon } from "@effectionx/process";
import { lines } from "@effectionx/stream-helpers";
import type { ImplementationHandlers } from "@tisyn/agent";
import { Host as HostDecl } from "../host-workflows.generated.js";
import { whenReady } from "./when-ready.js";

export interface HostHandle {
  daemon: Daemon;
  task: Task<void>;
  wsUrl: string;
}

export interface HostAgentState {
  hostHandle: HostHandle | null;
  journalPath: string;
  cwd: string;
  appUrl: string;
  retargetProxy: (newWsUrl: string) => void;
}

/**
 * Spawn the host as a daemon with `--port 0`, parse `TISYN_HOST_READY port=N`
 * from stdout, and return the handle. The daemon auto-terminates when its
 * enclosing task is halted.
 */
export function* startHost(cwd: string, journalPath: string): Operation<HostHandle> {
  const daemonReady = withResolvers<Daemon>();
  const stderrLines: string[] = [];
  const stdoutLines: string[] = [];

  const task = yield* spawn(function* () {
    const proc = yield* daemon("node", {
      arguments: ["dist/host.js", "--port", "0", "--journal", journalPath],
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        NODE_NO_WARNINGS: "1",
      },
    });
    daemonReady.resolve(proc);
    yield* proc;
  });

  const proc = yield* daemonReady.operation;

  // Capture stderr in background for diagnostics
  yield* spawn(function* () {
    const sub = yield* lines()(proc.stderr);
    let next = yield* sub.next();
    while (!next.done) {
      stderrLines.push(next.value);
      next = yield* sub.next();
    }
  });

  function formatDiagnostics(): string {
    const parts: string[] = [];
    if (stdoutLines.length) {
      parts.push(`stdout:\n${stdoutLines.join("\n")}`);
    }
    if (stderrLines.length) {
      parts.push(`stderr:\n${stderrLines.join("\n")}`);
    }
    return parts.length ? "\n" + parts.join("\n") : "";
  }

  // Wait for the ready line on stdout
  const wsUrl = yield* race([
    (function* (): Operation<string> {
      const subscription = yield* lines()(proc.stdout);
      let next = yield* subscription.next();
      while (!next.done) {
        stdoutLines.push(next.value);
        const match = next.value.match(/TISYN_HOST_READY port=(\d+)/);
        if (match) {
          return `ws://localhost:${match[1]}`;
        }
        next = yield* subscription.next();
      }
      throw new Error(`Host stdout closed before TISYN_HOST_READY${formatDiagnostics()}`);
    })(),
    (function* (): Operation<string> {
      yield* sleep(15000);
      throw new Error(`Host did not print TISYN_HOST_READY within 15s${formatDiagnostics()}`);
    })(),
  ]);

  return { daemon: proc, task, wsUrl };
}

type HostHandlers = ImplementationHandlers<ReturnType<typeof HostDecl>["operations"]>;

export function createHostAgentHandlers(state: HostAgentState): HostHandlers {
  return {
    *stop() {
      if (state.hostHandle) {
        yield* state.hostHandle.task.halt();
        state.hostHandle = null;
      }
    },
    *restart({ input }) {
      // Stop existing
      if (state.hostHandle) {
        yield* state.hostHandle.task.halt();
        state.hostHandle = null;
      }
      // Start new
      const jp = input.journalPath ?? state.journalPath;
      const handle = yield* startHost(state.cwd, jp);
      state.hostHandle = handle;
      state.retargetProxy(handle.wsUrl);
      // Confirm the new host is accepting connections
      yield* whenReady(handle.wsUrl, state.appUrl);
    },
  };
}
