import { agent, operation } from "@tisyn/agent";

export const testHost = agent("test-host", {
  stop: operation<{ input: Record<string, never> }, void>(),
  restart: operation<{ input: { journalPath?: string } }, void>(),
});

export const testBrowser = agent("test-browser", {
  open: operation<{ input: Record<string, never> }, void>(),
  reload: operation<{ input: Record<string, never> }, void>(),
  close: operation<{ input: Record<string, never> }, void>(),
  openSession: operation<{ input: { sessionId: string } }, void>(),
  switchSession: operation<{ input: { sessionId: string } }, void>(),
  closeSession: operation<{ input: { sessionId: string } }, void>(),
  fill: operation<{ input: { name: string; value: string } }, void>(),
  click: operation<{ input: { role: string; name: string } }, void>(),
  pressKey: operation<{ input: { key: string } }, void>(),
  expectVisible: operation<{ input: { text: string } }, void>(),
  expectNotVisible: operation<{ input: { text: string } }, void>(),
  expectDisabled: operation<{ input: { role: string; name: string } }, void>(),
  expectEnabled: operation<{ input: { role: string; name: string } }, void>(),
  expectTranscript: operation<{ input: { messages: string[] } }, void>(),
  expectStatusText: operation<{ input: { text: string } }, void>(),
});
