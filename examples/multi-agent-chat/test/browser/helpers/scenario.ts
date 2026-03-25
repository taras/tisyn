import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { call, resource } from "effection";
import type { Operation } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Call } from "@tisyn/ir";
import { chromium } from "playwright";

import { testHost, testBrowser } from "../agents.js";
import { useProxy } from "./proxy.js";
import { whenReady } from "./when-ready.js";
import { startHost, createHostAgentHandlers, type HostAgentState } from "./host-agent.js";
import { createBrowserAgentHandlers, type BrowserAgentState } from "./browser-agent.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const BROWSER_DIST = join(PROJECT_ROOT, "browser", "dist");

export function runScenario(
  workflow: (...args: never[]) => Operation<unknown>,
): Operation<void> {
  return resource(function* (provide) {
    // 1. Temp dir for journal
    const tempDir = mkdtempSync(join(tmpdir(), "tisyn-test-"));
    const journalPath = join(tempDir, "journal.ndjson");

    try {
      // 2. Start host
      const hostHandle = yield* startHost(PROJECT_ROOT, journalPath);

      // 3. Start reverse proxy
      const proxy = yield* useProxy(BROWSER_DIST, hostHandle.wsUrl);

      // 4. Wait until both host WS and proxy HTTP are ready
      yield* whenReady(hostHandle.wsUrl, proxy.appUrl);

      // 5. Launch Playwright browser
      const browser = yield* call(() => chromium.launch());

      try {
        const context = yield* call(() => browser.newContext());
        const page = yield* call(() => context.newPage());

        // 6. Set up agent state
        const hostAgentState: HostAgentState = {
          hostHandle,
          journalPath,
          cwd: PROJECT_ROOT,
          appUrl: proxy.appUrl,
          retargetProxy: (newWsUrl) => proxy.retarget(newWsUrl),
        };

        const browserAgentState: BrowserAgentState = {
          browser,
          sessions: new Map([["default", { context, page }]]),
          activeSessionId: "default",
          appUrl: proxy.appUrl,
        };

        // 7. Install agents
        const hostImpl = implementAgent(testHost, createHostAgentHandlers(hostAgentState));
        yield* hostImpl.install();

        const browserImpl = implementAgent(testBrowser, createBrowserAgentHandlers(browserAgentState));
        yield* browserImpl.install();

        // 8. Execute test workflow
        const stream = new InMemoryStream();
        const { result } = yield* execute({ ir: Call(workflow as any), stream });

        if (result.status === "err") {
          throw result.error;
        }
        if (result.status === "cancelled") {
          throw new Error("Workflow was cancelled");
        }

        yield* provide(undefined);
      } finally {
        yield* call(() => browser.close());
      }
    } finally {
      // Clean up temp dir
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });
}
