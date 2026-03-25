import { agent, operation } from "@tisyn/agent";

export const browser = agent("browser", {
  waitForUser: operation<{ input: { prompt: string } }, { message: string }>(),
  showAssistantMessage: operation<{ input: { message: string } }, void>(),
  hydrateTranscript: operation<
    { input: { messages: Array<{ role: string; content: string }> } },
    void
  >(),
  setReadOnly: operation<{ input: { reason: string } }, void>(),
});

export const llm = agent("llm", {
  sample: operation<
    {
      input: {
        history: Array<{ role: string; content: string }>;
        message: string;
      };
    },
    { message: string }
  >(),
});

export const state = agent("state", {
  getHistory: operation<
    { input: { placeholder: string } },
    Array<{ role: string; content: string }>
  >(),
  recordTurn: operation<{ input: { userMessage: string; assistantMessage: string } }, void>(),
});
