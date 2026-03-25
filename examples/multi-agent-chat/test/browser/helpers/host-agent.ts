import { type Operation, type Task, spawn, race, sleep, withResolvers } from "effection";
import { daemon, type Daemon } from "@effectionx/process";
import { lines } from "@effectionx/stream-helpers";
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

  const task = yield* spawn(function* () {
    const proc = yield* daemon("npx", {
      arguments: ["tsx", "src/host.ts", "--port", "0", "--journal", journalPath],
      cwd,
      env: {
        ...process.env as Record<string, string>,
        NODE_NO_WARNINGS: "1",
      },
    });
    daemonReady.resolve(proc);
    yield* proc;
  });

  const proc = yield* daemonReady.operation;

  // Wait for the ready line on stdout
  const wsUrl = yield* race([
    (function* (): Operation<string> {
      const subscription = yield* lines()(proc.stdout);
      let next = yield* subscription.next();
      while (!next.done) {
        const match = next.value.match(/TISYN_HOST_READY port=(\d+)/);
        if (match) {
          return `ws://localhost:${match[1]}`;
        }
        next = yield* subscription.next();
      }
      throw new Error("Host stdout closed before TISYN_HOST_READY");
    })(),
    (function* (): Operation<string> {
      yield* sleep(15000);
      throw new Error("Host did not print TISYN_HOST_READY within 15s");
    })(),
  ]);

  return { daemon: proc, task, wsUrl };
}

export function createHostAgentHandlers(state: HostAgentState) {
  return {
    *stop(): Operation<void> {
      if (state.hostHandle) {
        yield* state.hostHandle.task.halt();
        state.hostHandle = null;
      }
    },
    *restart({ input }: { input: { journalPath?: string } }): Operation<void> {
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
