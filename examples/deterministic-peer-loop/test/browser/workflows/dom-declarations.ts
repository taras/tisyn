import type { Workflow } from "@tisyn/agent";

export declare function Dom(): {
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
