import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { resource, withResolvers } from "effection";
import type { Operation } from "effection";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface Proxy {
  appUrl: string;
  retarget(newWsUrl: string): void;
}

export function useProxy(distDir: string, initialWsUrl: string): Operation<Proxy> {
  return resource(function* (provide) {
    let wsTarget = new URL(initialWsUrl);

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
      const filePath = join(distDir, pathname);

      try {
        const data = await readFile(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        // SPA fallback
        const indexPath = join(distDir, "index.html");
        try {
          const data = await readFile(indexPath);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
      }
    });

    // WebSocket upgrade: pipe to host
    server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const targetReq = require("node:http").request(
        {
          hostname: wsTarget.hostname,
          port: wsTarget.port,
          path: req.url,
          method: "GET",
          headers: {
            ...req.headers,
            host: `${wsTarget.hostname}:${wsTarget.port}`,
          },
        },
      );

      targetReq.on("upgrade", (_res: IncomingMessage, targetSocket: Socket, targetHead: Buffer) => {
        // Send the 101 back to the client
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
          `Upgrade: ${_res.headers.upgrade}\r\n` +
          `Connection: ${_res.headers.connection}\r\n` +
          `Sec-WebSocket-Accept: ${_res.headers["sec-websocket-accept"]}\r\n` +
          "\r\n",
        );
        if (targetHead.length) socket.write(targetHead);
        socket.pipe(targetSocket);
        targetSocket.pipe(socket);
      });

      targetReq.on("error", () => {
        socket.destroy();
      });

      targetReq.end();
      if (head.length) {
        targetReq.socket?.write(head);
      }
    });

    const listening = withResolvers<void>();
    server.listen(0, listening.resolve);
    yield* listening.operation;

    const addr = server.address() as AddressInfo;

    try {
      yield* provide({
        appUrl: `http://localhost:${addr.port}`,
        retarget(newWsUrl: string) {
          wsTarget = new URL(newWsUrl);
        },
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
}
