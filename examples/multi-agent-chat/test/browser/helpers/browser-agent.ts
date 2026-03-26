import { call } from "effection";
import { expect } from "@playwright/test";
import type { ImplementationHandlers } from "@tisyn/agent";
import type { Browser, BrowserContext, Page } from "playwright";
import { TestBrowser } from "../workflows.generated.js";

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

type BrowserHandlers = ImplementationHandlers<ReturnType<typeof TestBrowser>["operations"]>;

export function createBrowserAgentHandlers(state: BrowserAgentState): BrowserHandlers {
  return {
    *open() {
      yield* call(() => activePage(state).goto(state.appUrl));
    },
    *reload() {
      yield* call(() => activePage(state).reload());
    },
    *close() {
      yield* call(() => activePage(state).close());
    },

    *openSession({ input }) {
      const context = yield* call(() => state.browser.newContext());
      const page = yield* call(() => context.newPage());
      state.sessions.set(input.sessionId, { context, page });
      state.activeSessionId = input.sessionId;
      yield* call(() => page.goto(state.appUrl));
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

    *fill({ input }) {
      yield* call(() =>
        activePage(state).getByRole("textbox", { name: input.name }).fill(input.value),
      );
    },
    *click({ input }) {
      yield* call(() =>
        activePage(state).getByRole(input.role as any, { name: input.name }).click(),
      );
    },
    *pressKey({ input }) {
      yield* call(() => activePage(state).keyboard.press(input.key));
    },

    *expectVisible({ input }) {
      yield* call(() => expect(activePage(state).getByText(input.text)).toBeVisible());
    },
    *expectNotVisible({ input }) {
      yield* call(() => expect(activePage(state).getByText(input.text)).not.toBeVisible());
    },
    *expectDisabled({ input }) {
      yield* call(() =>
        expect(activePage(state).getByRole(input.role as any, { name: input.name })).toBeDisabled(),
      );
    },
    *expectEnabled({ input }) {
      yield* call(() =>
        expect(activePage(state).getByRole(input.role as any, { name: input.name })).toBeEnabled(),
      );
    },
    *expectStatusText({ input }) {
      yield* call(() => expect(activePage(state).getByRole("status")).toHaveText(input.text));
    },
    *expectTranscript({ input }) {
      const page = activePage(state);
      const log = page.getByRole("log");
      const items = log.locator(".message");

      yield* call(async () => {
        await expect(items).toHaveCount(input.messages.length);
        for (let i = 0; i < input.messages.length; i++) {
          await expect(items.nth(i)).toHaveText(input.messages[i]!);
        }
      });
    },
  };
}
