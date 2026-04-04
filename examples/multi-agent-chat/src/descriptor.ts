import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";

export default workflow({
  run: { export: "chat", module: "../src/workflow.ts" },
  agents: [
    agent("llm", transport.worker("./llm-worker.js")),
    agent("app", transport.local("./browser-agent.js")),
    agent("d-b", transport.inprocess("./db-agent.js"), {
      dbPath: env("CHAT_DB_PATH", "./data/chat.json"),
    }),
  ],
  journal: journal.memory(),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({
        port: env("PORT", 3000),
        static: "../browser/dist",
      }),
    }),
  },
});
