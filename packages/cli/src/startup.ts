/**
 * Transport, server, and journal lifecycle orchestration for `tsn run`.
 *
 * Maps resolved config to concrete transport factories, journal streams,
 * and server instances.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { call, resource, withResolvers } from "effection";
import type { Operation } from "effection";
import { installAgentTransport } from "@tisyn/transport";
import { workerTransport } from "@tisyn/transport/worker";
import { stdioTransport } from "@tisyn/transport/stdio";
import { websocketTransport } from "@tisyn/transport/websocket";
import type { AgentTransportFactory } from "@tisyn/transport";
import { InMemoryStream } from "@tisyn/durable-streams";
import type { DurableStream } from "@tisyn/durable-streams";
import type { ResolvedConfig, ResolvedAgent, ResolvedJournal, ResolvedServer } from "@tisyn/runtime";
import { WebSocketServer } from "ws";
import { CliError } from "./load-descriptor.js";

/**
 * Create a transport factory for a resolved agent.
 */
export async function createTransportFactory(agent: ResolvedAgent): Promise<AgentTransportFactory> {
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

    case "local":
    case "inprocess": {
      const modulePath = agent.transport.module as string;
      let mod: Record<string, unknown>;
      try {
        mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new CliError(3, `Failed to load transport module '${modulePath}': ${msg}`);
      }
      if (typeof mod.createTransport !== "function") {
        throw new CliError(
          2,
          `Module '${modulePath}' must export createTransport()`,
        );
      }
      return (mod.createTransport as () => AgentTransportFactory)();
    }

    default:
      throw new CliError(2, `Unknown transport kind '${kind}' for agent '${agent.id}'`);
  }
}

/**
 * Install all agent transports from resolved config.
 */
export function* installAllTransports(config: ResolvedConfig): Operation<void> {
  for (const agentConfig of config.agents) {
    const factory: AgentTransportFactory = yield* call(() => createTransportFactory(agentConfig));
    yield* installAgentTransport(agentConfig.id, factory);
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
 * Start an HTTP+WebSocket server from resolved server config.
 * Returns an Effection resource that tears down on scope exit.
 */
export function* startServer(
  serverConfig: ResolvedServer,
  ready?: () => void,
): Operation<void> {
  yield* resource(function* (provide) {
    const httpServer = createServer((req, res) => {
      if (serverConfig.static && req.url) {
        const urlPath = req.url === "/" ? "/index.html" : req.url;
        const filePath = join(serverConfig.static, urlPath);
        try {
          const content = readFileSync(filePath);
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

    const listening = withResolvers<void>();
    httpServer.on("error", (err: Error) => listening.reject(err));
    httpServer.listen(serverConfig.port, listening.resolve);
    yield* listening.operation;

    console.log(`Server listening on http://localhost:${serverConfig.port}`);
    ready?.();

    try {
      yield* provide(undefined);
    } finally {
      wss.close();
      httpServer.close();
    }
  });
}
