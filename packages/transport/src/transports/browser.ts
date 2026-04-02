import type { Operation } from "effection";
import { call, createChannel, createScope, ensure } from "effection";
import type { OperationSpec } from "@tisyn/agent";
import { agent, operation, implementAgent } from "@tisyn/agent";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "../transport.js";
import { createProtocolServer } from "../protocol-server.js";
import type { Browser as PWBrowser, BrowserContext, Page } from "playwright-core";
import { chromium, firefox, webkit } from "playwright-core";

// ── Types ──

export interface BrowserTransportConfig {
  /** Whether to run the browser in headless mode. Default: true. */
  headless?: boolean;
  /** Default viewport dimensions for new pages. Default: { width: 1280, height: 720 }. */
  viewport?: { width: number; height: number };
  /** Browser engine to use. Default: "chromium". */
  engine?: "chromium" | "firefox" | "webkit";
  /** Additional browser launch arguments. Default: []. */
  launchArgs?: string[];
}

export interface NavigateParams {
  url: string;
  page?: string;
  timeout?: number;
}

export interface NavigateResult {
  page: string;
  status: number;
  url: string;
}

export interface ClickParams {
  selector: string;
  page?: string;
  timeout?: number;
}

export interface ClickResult {
  ok: true;
}

export interface FillParams {
  selector: string;
  value: string;
  page?: string;
  timeout?: number;
}

export interface FillResult {
  ok: true;
}

export interface ContentParams {
  page?: string;
  format?: "text" | "html";
}

export interface ContentResult {
  text: string;
  url: string;
  title: string;
}

export interface ScreenshotParams {
  page?: string;
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
}

export interface ScreenshotResult {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface SelectPageParams {
  page: string;
}

export interface SelectPageResult {
  page: string;
  url: string;
}

export interface ClosePageParams {
  page: string;
}

export interface ClosePageResult {
  ok: true;
  activePage: string | null;
}

// ── Runtime declaration ──

type BrowserOps = {
  navigate: OperationSpec<NavigateParams, NavigateResult>;
  click: OperationSpec<ClickParams, ClickResult>;
  fill: OperationSpec<FillParams, FillResult>;
  content: OperationSpec<ContentParams, ContentResult>;
  screenshot: OperationSpec<ScreenshotParams, ScreenshotResult>;
  selectPage: OperationSpec<SelectPageParams, SelectPageResult>;
  closePage: OperationSpec<ClosePageParams, ClosePageResult>;
};

export const Browser = agent<BrowserOps>("browser", {
  navigate: operation<NavigateParams, NavigateResult>(),
  click: operation<ClickParams, ClickResult>(),
  fill: operation<FillParams, FillResult>(),
  content: operation<ContentParams, ContentResult>(),
  screenshot: operation<ScreenshotParams, ScreenshotResult>(),
  selectPage: operation<SelectPageParams, SelectPageResult>(),
  closePage: operation<ClosePageParams, ClosePageResult>(),
});

// ── Browser transport factory ──

const ENGINE_MAP = {
  chromium,
  firefox,
  webkit,
} as const;

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

/**
 * Create a transport factory for a browser agent. The factory launches a
 * Playwright browser, creates a default page, and maps browser contract
 * operations to Playwright API calls via the agent protocol.
 *
 * Follows the same structural pattern as `inprocessTransport`: bidirectional
 * channels, protocol server in an isolated scope, cleanup on scope exit.
 */
export function browserTransport(config?: BrowserTransportConfig): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
    const headless = config?.headless ?? true;
    const viewport = config?.viewport ?? DEFAULT_VIEWPORT;
    const engineName = config?.engine ?? "chromium";
    const launchArgs = config?.launchArgs ?? [];

    const browserType = ENGINE_MAP[engineName];
    if (!browserType) {
      throw new Error(`Unknown browser engine: ${engineName}`);
    }

    // Launch browser
    const browser: PWBrowser = yield* call(() =>
      browserType.launch({ headless, args: launchArgs }),
    );
    yield* ensure(() => {
      browser.close().catch(() => {});
    });

    // Create context + default page
    const context: BrowserContext = yield* call(() =>
      browser.newContext({ viewport }),
    );
    const defaultPage: Page = yield* call(() => context.newPage());

    // Page registry
    const pages = new Map<string, Page>([["page:0", defaultPage]]);
    let activePage = "page:0";
    let pageCounter = 0;

    // Resolve target page from optional page param
    function resolvePage(pageId?: string): Page {
      const id = pageId ?? activePage;
      const page = pages.get(id);
      if (!page) {
        throw new Error(`Page not found: ${id}`);
      }
      return page;
    }

    // Create handlers
    const handlers = {
      *navigate(params: NavigateParams): Operation<NavigateResult> {
        const page = resolvePage(params.page);
        const response = yield* call(() =>
          page.goto(params.url, { timeout: params.timeout ?? 30000 }),
        );
        const pageId = params.page ?? activePage;
        activePage = pageId;
        return {
          page: pageId,
          status: response?.status() ?? 0,
          url: page.url(),
        };
      },

      *click(params: ClickParams): Operation<ClickResult> {
        const page = resolvePage(params.page);
        yield* call(() =>
          page.click(params.selector, { timeout: params.timeout ?? 30000 }),
        );
        return { ok: true as const };
      },

      *fill(params: FillParams): Operation<FillResult> {
        const page = resolvePage(params.page);
        yield* call(() =>
          page.fill(params.selector, params.value, {
            timeout: params.timeout ?? 30000,
          }),
        );
        return { ok: true as const };
      },

      *content(params: ContentParams): Operation<ContentResult> {
        const page = resolvePage(params.page);
        const format = params.format ?? "text";
        let text: string;
        if (format === "html") {
          text = yield* call(() => page.content());
        } else {
          text = yield* call(() => page.innerText("body"));
        }
        return {
          text,
          url: page.url(),
          title: yield* call(() => page.title()),
        };
      },

      *screenshot(params: ScreenshotParams): Operation<ScreenshotResult> {
        const page = resolvePage(params.page);
        const format = params.format ?? "png";
        const buffer: Buffer = yield* call(() =>
          page.screenshot({
            fullPage: params.fullPage ?? false,
            type: format,
            ...(format === "jpeg" && params.quality != null
              ? { quality: params.quality }
              : {}),
          }),
        );
        const data = buffer.toString("base64");
        const viewportSize = page.viewportSize();
        return {
          data,
          mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
          width: viewportSize?.width ?? viewport.width,
          height: viewportSize?.height ?? viewport.height,
        };
      },

      *selectPage(params: SelectPageParams): Operation<SelectPageResult> {
        const page = resolvePage(params.page);
        activePage = params.page;
        return {
          page: params.page,
          url: page.url(),
        };
      },

      *closePage(params: ClosePageParams): Operation<ClosePageResult> {
        const page = resolvePage(params.page);

        if (pages.size <= 1) {
          throw new Error("Cannot close the last remaining page");
        }

        yield* call(() => page.close());
        pages.delete(params.page);

        // If closing the active page, select another
        let newActive: string | null = null;
        if (activePage === params.page) {
          const firstRemaining = pages.keys().next().value!;
          activePage = firstRemaining;
          newActive = firstRemaining;
        } else {
          newActive = activePage;
        }

        return { ok: true as const, activePage: newActive };
      },
    };

    // Create bidirectional channels (same pattern as inprocessTransport)
    const hostToAgent = createChannel<HostMessage, void>();
    const agentToHost = createChannel<AgentMessage, void>();

    // Subscribe BEFORE spawning so the subscription exists when sends arrive
    const hostSub = yield* hostToAgent;

    const impl = implementAgent(Browser, handlers);
    const server = createProtocolServer(impl);

    // Create an isolated scope (parented to Effection global root)
    const [agentScope, destroyScope] = createScope();
    yield* ensure(destroyScope);

    // Start the server loop inside the isolated scope
    agentScope.run(function* () {
      yield* server.use({
        *receive() {
          return hostSub;
        },
        *send(msg) {
          yield* agentToHost.send(msg);
        },
      });
      yield* agentToHost.close();
    });

    return {
      *send(message: HostMessage) {
        yield* hostToAgent.send(message);
      },
      receive: agentToHost,
    };
  };
}
