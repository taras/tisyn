// Reads one message from stdin, responds with valid init,
// then writes malformed JSON to stdout.

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
          result: { protocolVersion: "1.0", sessionId: "bad-json-session" },
        }) + "\n",
      );
    } else if (msg.method === "execute") {
      // Write malformed JSON
      process.stdout.write("this is not valid json\n");
    } else if (msg.method === "shutdown") {
      process.exit(0);
    }
  }
});
