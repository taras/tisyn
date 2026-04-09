import { workflow, agent, transport, journal } from "@tisyn/config";

export default workflow({
  run: "assist",
  agents: [
    agent("claude-code", transport.local("./claude-code-binding.ts")),
    agent("output", transport.inprocess("./src/output-agent.ts")),
  ],
  journal: journal.memory(),
});
