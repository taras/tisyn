/**
 * Transport, server, and journal lifecycle orchestration for `tsn run`.
 *
 * Maps resolved config to concrete transport factories, journal streams,
 * and server instances.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { call, createSignal, resource, withResolvers } from "effection";
import type { Operation } from "effection";
import { installAgentTransport } from "@tisyn/transport";
import { workerTransport } from "@tisyn/transport/worker";
import { stdioTransport } from "@tisyn/transport/stdio";
import { websocketTransport } from "@tisyn/transport/websocket";
import type {
  AgentTransportFactory,
  LocalAgentBinding,
  LocalServerBinding,
} from "@tisyn/transport";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableStream } from "@tisyn/durable-streams";
import type {
  ResolvedConfig,
  ResolvedAgent,
  ResolvedJournal,
  ResolvedServer,
} from "@tisyn/runtime";
import { WebSocket, WebSocketServer } from "ws";
import { CliError } from "./load-descriptor.js";

/**
 * Create a transport factory for a non-local resolved agent
 * (worker, stdio, websocket).
 */
export function* createTransportFactory(agent: ResolvedAgent): Operation<AgentTransportFactory> {
  const kind = agent.transport.kind as string;

  switch (kind) {
    case "worker":
      return workerTransport({ url: agent.transport.url as string });

    case "stdio":
      return stdioTransport({
        command: agent.transport.command as string,
        arguments: agent.transport.args as string[] | undefined,
      });

    case "websocket":
      return websocketTransport({ url: agent.transport.url as string });

    default:
      throw new CliError(2, `Unknown transport kind '${kind}' for agent '${agent.id}'`);
  }
}

/**
 * Load a local/inprocess module and return its binding.
 *
 * Prefers `createBinding()` (returns LocalAgentBinding) over
 * `createTransport()` (returns AgentTransportFactory, wrapped).
 */
export function* loadLocalBinding(
  modulePath: string,
  agentConfig?: Record<string, unknown>,
): Operation<LocalAgentBinding> {
  let mod: Record<string, unknown>;
  try {
    mod = yield* call(
      () => import(pathToFileURL(modulePath).href) as Promise<Record<string, unknown>>,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(3, `Failed to load transport module '${modulePath}': ${msg}`);
  }

  if (typeof mod.createBinding === "function") {
    return (mod.createBinding as (config?: Record<string, unknown>) => LocalAgentBinding)(agentConfig);
  }

  if (typeof mod.createTransport === "function") {
    return { transport: (mod.createTransport as () => AgentTransportFactory)() };
  }

  throw new CliError(2, `Module '${modulePath}' must export createBinding() or createTransport()`);
}

/**
 * Install all agent transports from resolved config.
 *
 * For local/inprocess agents, loads the module binding and calls
 * `bindServer()` (if present) before installing the transport.
 * `bindServer` is a setup-only hook: it spawns any long-lived work
 * and returns promptly so startup can proceed.
 */
export function* installAllTransports(
  config: ResolvedConfig,
  serverBinding?: LocalServerBinding,
): Operation<void> {
  for (const agentConfig of config.agents) {
    const kind = agentConfig.transport.kind as string;

    if (kind === "local" || kind === "inprocess") {
      const modulePath = agentConfig.transport.module as string;
      const binding = yield* loadLocalBinding(modulePath, agentConfig.config);

      if (binding.bindServer && serverBinding) {
        yield* binding.bindServer(serverBinding);
      }

      yield* installAgentTransport(agentConfig.id, binding.transport);
    } else {
      const factory = yield* createTransportFactory(agentConfig);
      yield* installAgentTransport(agentConfig.id, factory);
    }
  }
}

/**
 * Create a journal stream from resolved journal config.
 */
export function createJournalStream(journal: ResolvedJournal): DurableStream {
  switch (journal.kind) {
    case "memory":
      return new InMemoryStream();

    case "file":
      throw new CliError(
        2,
        `File-backed journaling is not yet implemented (configured path: '${journal.path}'). Use journal.memory() or omit the journal field.`,
      );

    default:
      throw new CliError(2, `Unknown journal kind '${journal.kind}'`);
  }
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/**
 * Wrap a raw WebSocket as an Effection resource that closes on scope exit.
 */
function useConnection(rawWs: WebSocket): Operation<WebSocket> {
  return resource(function* (provide) {
    try {
      yield* provide(rawWs);
    } finally {
      rawWs.close();
    }
  });
}

/**
 * Start an HTTP+WebSocket server from resolved server config.
 * Returns a LocalServerBinding with the server address and a stream
 * of accepted WebSocket connections. Does not expose raw WebSocketServer.
 */
export function startServer(serverConfig: ResolvedServer): Operation<LocalServerBinding> {
  return resource(function* (provide) {
    const httpServer = createServer(async (req, res) => {
      if (serverConfig.static && req.url) {
        const urlPath = req.url === "/" ? "/index.html" : req.url;
        const filePath = join(serverConfig.static, urlPath);
        try {
          const content = await readFile(filePath);
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end("Not Found");
        }
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
    });

    const wss = new WebSocketServer({ server: httpServer });
    const connections = createSignal<Operation<WebSocket>, never>();

    const connectionHandler = (rawWs: WebSocket) => {
      connections.send(useConnection(rawWs));
    };
    wss.on("connection", connectionHandler);

    const listening = withResolvers<void>();
    const onError = (err: Error) => listening.reject(err);
    httpServer.on("error", onError);
    httpServer.listen(serverConfig.port, () => {
      httpServer.off("error", onError);
      listening.resolve();
    });
    yield* listening.operation;

    try {
      yield* provide({
        address: httpServer.address() as AddressInfo,
        connections,
      });
    } finally {
      wss.off("connection", connectionHandler);
      wss.close();
      httpServer.close();
    }
  });
}
