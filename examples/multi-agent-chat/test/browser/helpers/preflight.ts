import { call, withResolvers } from "effection";
import type { Operation } from "effection";
import { createServer } from "node:net";

export function assertLocalListenSupported(): Operation<void> {
  const server = createServer();
  const check = withResolvers<void>();

  server.on("error", (err: NodeJS.ErrnoException) => {
    check.reject(
      new Error(
        `Browser acceptance tests require local listening sockets, ` +
          `but this environment denied listen() on 0.0.0.0:0.\n\n` +
          `Original error: ${err.message} (${err.code})`
      )
    );
  });

  server.listen(0, () => {
    server.close(() => check.resolve());
  });

  return check.operation;
}
