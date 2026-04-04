/**
 * DB agent — in-process persistence via JSON file.
 *
 * Demo-minimal: synchronous file I/O, single file, single conversation,
 * no concurrent-write protection.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { DB } from "./workflow.generated.js";

type Message = { role: string; content: string };

function readMessages(dbPath: string): Message[] {
  try {
    return JSON.parse(readFileSync(dbPath, "utf-8")) as Message[];
  } catch {
    return [];
  }
}

function appendMessage(dbPath: string, msg: Message): void {
  const messages = readMessages(dbPath);
  messages.push(msg);
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, JSON.stringify(messages, null, 2));
}

export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const dbPath = (config?.dbPath as string) ?? "./data/chat.json";

  return {
    transport: inprocessTransport(DB(), {
      *loadMessages() {
        return readMessages(dbPath);
      },
      *appendMessage({ input }) {
        appendMessage(dbPath, input);
      },
    }),
  };
}
