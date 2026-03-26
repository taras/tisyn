import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

export default defineConfig({
  root: "browser",
  plugins: [
    react(),
    {
      name: "ws-proxy",
      configureServer(server) {
        server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
          // Don't proxy Vite's own HMR WebSocket
          if (req.headers["sec-websocket-protocol"]?.includes("vite-hmr")) return;
          const proxyReq = request({
            hostname: "localhost",
            port: 3000,
            path: req.url,
            method: "GET",
            headers: { ...req.headers, host: "localhost:3000" },
          });
          proxyReq.on(
            "upgrade",
            (_res: IncomingMessage, proxySocket: Socket, proxyHead: Buffer) => {
              socket.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                  `Upgrade: ${_res.headers.upgrade}\r\n` +
                  `Connection: ${_res.headers.connection}\r\n` +
                  `Sec-WebSocket-Accept: ${_res.headers["sec-websocket-accept"]}\r\n` +
                  "\r\n",
              );
              if (proxyHead.length) socket.write(proxyHead);
              socket.on("error", () => socket.destroy());
              proxySocket.on("error", () => proxySocket.destroy());
              socket.pipe(proxySocket);
              proxySocket.pipe(socket);
            },
          );
          proxyReq.on("error", () => socket.destroy());
          proxyReq.end();
          if (head.length) proxyReq.socket?.write(head);
        });
      },
    },
  ],
  server: { port: 4173 },
});
