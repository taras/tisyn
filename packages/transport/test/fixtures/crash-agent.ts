// Responds to initialize, then exits abruptly on execute.

process.stdin.setEncoding("utf8");

let buffer = "";
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);

    if (msg.method === "initialize") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { protocolVersion: "1.0", sessionId: "crash-session" },
        }) + "\n",
      );
    } else if (msg.method === "execute") {
      // Exit abruptly without sending a response
      process.exit(1);
    }
  }
});
