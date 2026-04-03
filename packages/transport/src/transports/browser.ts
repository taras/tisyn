import type { Operation } from "effection";
import { call, createChannel, createScope, ensure, scoped } from "effection";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import { agent, operation, implementAgent } from "@tisyn/agent";
import type { IrInput, Json } from "@tisyn/ir";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "../transport.js";
import { createProtocolServer } from "../protocol-server.js";

// Playwright types only — erased at runtime, no module load
import type { Browser as PWBrowser, BrowserContext, Page } from "playwright-core";

// ── Capability composition ──

/**
 * A browser-local capability installer. When called, installs agent
 * dispatch middleware into the current Effection scope so that incoming
 * IR can dispatch to the agent locally.
 *
 * This is the single composition interface used in both in-process and
 * real-browser execution modes.
 */
export type LocalCapability = () => Operation<void>;

/**
 * A function that evaluates a workflow IR using the full runtime
 * and returns its result as a JSON-serializable value.
 *
 * Create one via `createInProcessRunner()` from `@tisyn/transport/browser-executor`.
 */
export type InProcessRunner = (workflow: IrInput) => Operation<Json>;

/**
 * Create a browser-local capability from an agent declaration and handlers.
 *
 * The returned `LocalCapability` installs the agent's dispatch middleware
 * via `implementAgent(declaration, handlers).install()`.
 *
 * Used in both execution modes:
 * - In-process: passed to `browserTransport({ capabilities: [...] })`
 * - Real-browser: passed to `createBrowserExecutor([...])`
 */
export function localCapability<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): LocalCapability {
  return function* () {
    const impl = implementAgent(declaration, handlers);
    yield* impl.install();
  };
}

// ── Types ──

export interface NavigateParams {
  url: string;
}

export interface ExecuteParams {
  workflow: IrInput;
}

// ── Runtime declaration ──

type BrowserOps = {
  navigate: OperationSpec<NavigateParams, void>;
  execute: OperationSpec<ExecuteParams, Json>;
};

export const Browser = agent<BrowserOps>("browser", {
  navigate: operation<NavigateParams, void>(),
  execute: operation<ExecuteParams, Json>(),
});

// ── Browser transport factory ──

export interface BrowserTransportConfig {
  /** Whether to run the browser in headless mode. Default: true. */
  headless?: boolean;
  /** Default viewport dimensions for new pages. Default: { width: 1280, height: 720 }. */
  viewport?: { width: number; height: number };
  /** Browser engine to use. Default: "chromium". */
  engine?: "chromium" | "firefox" | "webkit";
  /** Additional browser launch arguments. Default: []. */
  launchArgs?: string[];
  /** URL to navigate to during setup. */
  url?: string;

  /**
   * Browser-local capabilities installed before each execute call.
   * Used in in-process execution mode (when run is provided).
   */
  capabilities?: LocalCapability[];

  /**
   * In-process execution function for running IR without Playwright.
   * Required when executor path is not provided.
   * Create one via createInProcessRunner() from @tisyn/transport/browser-executor.
   */
  run?: InProcessRunner;

  /**
   * Path to executor IIFE bundle for real-browser execution.
   * The bundle must be built using createBrowserExecutor() with
   * the desired capabilities.
   *
   * When provided: real-browser mode — requires playwright-core,
   * launches browser, injects executor, sends IR via page.evaluate.
   *
   * When omitted with run: in-process mode — no Playwright dependency,
   * executes IR using the injected runner with configured capabilities.
   */
  executor?: string;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

/**
 * Create a transport factory for a browser agent.
 *
 * Supports two execution modes:
 * - **In-process** (run provided, executor omitted): executes IR using
 *   the injected runner with configured capabilities. No Playwright dependency.
 * - **Real-browser** (executor provided): launches a Playwright browser,
 *   injects the executor IIFE, and sends IR via page.evaluate. Requires
 *   playwright-core.
 *
 * Follows the same structural pattern as inprocessTransport: bidirectional
 * channels, protocol server in an isolated scope, cleanup on scope exit.
 */
export function browserTransport(config?: BrowserTransportConfig): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
    const capabilities = config?.capabilities ?? [];
    const executorPath = config?.executor;

    // Build handlers based on mode
    let navigateHandler: (params: NavigateParams) => Operation<void>;
    let executeHandler: (params: ExecuteParams) => Operation<Json>;

    if (executorPath) {
      // ── Real-browser mode: launch Playwright, inject executor ──
      const headless = config?.headless ?? true;
      const viewport = config?.viewport ?? DEFAULT_VIEWPORT;
      const engineName = config?.engine ?? "chromium";
      const launchArgs = config?.launchArgs ?? [];
      const url = config?.url;

      // Dynamic import — playwright-core is only loaded for real-browser mode
      const pw: typeof import("playwright-core") = yield* call(() => import("playwright-core"));
      const engineMap = { chromium: pw.chromium, firefox: pw.firefox, webkit: pw.webkit } as const;
      const browserType = engineMap[engineName];
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
      const context: BrowserContext = yield* call(() => browser.newContext({ viewport }));
      const page: Page = yield* call(() => context.newPage());

      // Navigate to URL if configured
      if (url) {
        yield* call(() => page.goto(url));
      }

      // Inject executor bundle
      yield* call(() => page.addScriptTag({ path: executorPath }));
      yield* call(() =>
        page.waitForFunction(() => typeof (globalThis as any).__tisyn_execute === "function"),
      );

      navigateHandler = function* (params: NavigateParams): Operation<void> {
        yield* call(() => page.goto(params.url));
      };

      executeHandler = function* (params: ExecuteParams): Operation<Json> {
        const result: any = yield* call(() =>
          page.evaluate((ir) => (window as any).__tisyn_execute(ir), params.workflow as unknown),
        );
        if (result.status === "err") {
          throw new Error(result.error?.message ?? "Browser workflow failed");
        }
        return result.value as Json;
      };
    } else if (config?.run) {
      // ── In-process mode: injected runner, no Playwright ──
      const runner = config.run;

      navigateHandler = function* (): Operation<void> {
        throw new Error("Browser.navigate requires real-browser mode (provide executor config)");
      };
      executeHandler = function* (params: ExecuteParams): Operation<Json> {
        return yield* scoped(function* () {
          for (const cap of capabilities) {
            yield* cap();
          }
          return yield* runner(params.workflow);
        });
      };
    } else {
      throw new Error(
        "browserTransport requires either 'executor' (real-browser) or 'run' (in-process)",
      );
    }

    // Create handler object
    const handlers = {
      *navigate(params: NavigateParams): Operation<void> {
        return yield* navigateHandler(params);
      },
      *execute(params: ExecuteParams): Operation<Json> {
        return yield* executeHandler(params);
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
