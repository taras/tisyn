import { call, type Operation } from "effection";
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
  if (!session) {
    throw new Error(`No session "${state.activeSessionId}"`);
  }
  return session.page;
}

function* injectExecutor(page: Page): Operation<void> {
  yield* call(() => page.addScriptTag({ path: EXECUTOR_BUNDLE_PATH }));
  yield* call(() =>
    page.waitForFunction(() => typeof (window as any).__tisyn_execute === "function"),
  );
}

type BrowserHandlers = ImplementationHandlers<ReturnType<typeof BrowserDecl>["operations"]>;

export function createBrowserAgentHandlers(state: BrowserAgentState): BrowserHandlers {
  return {
    *open() {
      const page = activePage(state);
      yield* call(() => page.goto(state.appUrl));
      yield* injectExecutor(page);
    },
    *close() {
      const page = activePage(state);
      yield* call(() => page.close());
    },
    *reload() {
      const page = activePage(state);
      yield* call(() => page.reload());
      yield* injectExecutor(page);
    },
    *openSession({ sessionId }) {
      const context = yield* call(() => state.browser.newContext());
      const page = yield* call(() => context.newPage());
      state.sessions.set(sessionId, { context, page });
      state.activeSessionId = sessionId;
      yield* call(() => page.goto(state.appUrl));
      yield* injectExecutor(page);
    },
    *switchSession({ sessionId }) {
      if (!state.sessions.has(sessionId)) {
        throw new Error(`No session "${sessionId}"`);
      }
      state.activeSessionId = sessionId;
    },
    *closeSession({ sessionId }) {
      const session = state.sessions.get(sessionId);
      if (session) {
        yield* call(() => session.page.close());
        yield* call(() => session.context.close());
        state.sessions.delete(sessionId);
      }
    },
    *execute({ workflow }) {
      const page = activePage(state);
      const result: any = yield* call(() =>
        page.evaluate((ir) => (window as any).__tisyn_execute(ir), workflow as unknown),
      );
      if (result.status === "err") {
        throw new Error(result.error?.message ?? "Browser workflow failed");
      }
    },
  };
}
