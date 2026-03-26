import { call } from "effection";
import type { ImplementationHandlers } from "@tisyn/agent";
import type { Browser, BrowserContext, Page } from "playwright";
import { Browser as BrowserDecl } from "../host-workflows.generated.js";

const EXECUTOR_BUNDLE_PATH = new URL(
  "../dist-executor/tisyn-test-executor.iife.js",
  import.meta.url,
).pathname;

export interface BrowserAgentState {
  browser: Browser;
  sessions: Map<string, { context: BrowserContext; page: Page }>;
  activeSessionId: string;
  appUrl: string;
}

function activePage(state: BrowserAgentState): Page {
  const session = state.sessions.get(state.activeSessionId);
  if (!session) throw new Error(`No session "${state.activeSessionId}"`);
  return session.page;
}

async function injectExecutor(page: Page): Promise<void> {
  await page.addScriptTag({ path: EXECUTOR_BUNDLE_PATH });
  await page.waitForFunction(
    () => typeof (window as any).__tisyn_execute === "function",
  );
}

type BrowserHandlers = ImplementationHandlers<
  ReturnType<typeof BrowserDecl>["operations"]
>;

export function createBrowserAgentHandlers(
  state: BrowserAgentState,
): BrowserHandlers {
  return {
    *open() {
      const page = activePage(state);
      yield* call(() => page.goto(state.appUrl));
      yield* call(() => injectExecutor(page));
    },
    *close() {
      yield* call(() => activePage(state).close());
    },
    *reload() {
      const page = activePage(state);
      yield* call(() => page.reload());
      yield* call(() => injectExecutor(page));
    },
    *openSession({ input }) {
      const context = yield* call(() => state.browser.newContext());
      const page = yield* call(() => context.newPage());
      state.sessions.set(input.sessionId, { context, page });
      state.activeSessionId = input.sessionId;
      yield* call(() => page.goto(state.appUrl));
      yield* call(() => injectExecutor(page));
    },
    *switchSession({ input }) {
      if (!state.sessions.has(input.sessionId)) {
        throw new Error(`No session "${input.sessionId}"`);
      }
      state.activeSessionId = input.sessionId;
    },
    *closeSession({ input }) {
      const session = state.sessions.get(input.sessionId);
      if (session) {
        yield* call(() => session.page.close());
        yield* call(() => session.context.close());
        state.sessions.delete(input.sessionId);
      }
    },
    *execute({ input }) {
      const page = activePage(state);
      const result: any = yield* call(() =>
        page.evaluate(
          (ir) => (window as any).__tisyn_execute(ir),
          input.workflow,
        ),
      );
      if (result.status === "err") {
        throw new Error(result.error?.message ?? "Browser workflow failed");
      }
    },
  };
}
