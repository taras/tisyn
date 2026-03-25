import type { Workflow } from "@tisyn/agent";

declare function TestHost(): {
  stop(input: Record<string, never>): Workflow<void>;
  restart(input: { journalPath?: string }): Workflow<void>;
};

declare function TestBrowser(): {
  open(input: Record<string, never>): Workflow<void>;
  reload(input: Record<string, never>): Workflow<void>;
  close(input: Record<string, never>): Workflow<void>;
  openSession(input: { sessionId: string }): Workflow<void>;
  switchSession(input: { sessionId: string }): Workflow<void>;
  closeSession(input: { sessionId: string }): Workflow<void>;
  fill(input: { name: string; value: string }): Workflow<void>;
  click(input: { role: string; name: string }): Workflow<void>;
  pressKey(input: { key: string }): Workflow<void>;
  expectVisible(input: { text: string }): Workflow<void>;
  expectNotVisible(input: { text: string }): Workflow<void>;
  expectDisabled(input: { role: string; name: string }): Workflow<void>;
  expectEnabled(input: { role: string; name: string }): Workflow<void>;
  expectTranscript(input: { messages: string[] }): Workflow<void>;
  expectStatusText(input: { text: string }): Workflow<void>;
};
