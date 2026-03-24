import { useEffect, useRef, useState } from "react";
import type { Queue } from "effection";
import { createQueue, each, run, spawn } from "effection";
import { useWebSocket } from "@effectionx/websocket";
import { implementAgent } from "@tisyn/agent";
import type { AgentMessage, HostMessage } from "@tisyn/protocol";
import { parseHostMessage } from "@tisyn/protocol";
import { createProtocolServer } from "@tisyn/transport/protocol-server";
import { Browser } from "../../src/workflow.generated.ts";

export interface Status {
  text: string;
  level: "connected" | "disconnected" | "pending";
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export function useChat(url = "ws://localhost:3000") {
  const [status, setStatus] = useState<Status>({ text: "Disconnected", level: "disconnected" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(false);
  const userInputQueueRef = useRef<Queue<string, void> | null>(null);

  useEffect(() => {
    const task = run(function* () {
      const userInputQueue = createQueue<string, void>();
      userInputQueueRef.current = userInputQueue;

      const ws = yield* useWebSocket<string>(url);

      setStatus({ text: "Connected — waiting for host...", level: "connected" });

      // Parse incoming WebSocket frames into HostMessages
      const hostMessageQueue = createQueue<HostMessage, void>();

      yield* spawn(function* () {
        for (const event of yield* each(ws)) {
          const parsed = parseHostMessage(JSON.parse(event.data));
          hostMessageQueue.add(parsed);
          yield* each.next();
        }
        hostMessageQueue.close();
      });

      // Build the agent implementation with React-bridging handlers
      const impl = implementAgent(Browser(), {
        *waitForUser({ input }) {
          const prompt = input.prompt || "Say something";
          setStatus({ text: prompt, level: "connected" });
          setInputEnabled(true);

          // Block until React's sendMessage pushes to the queue
          const next = yield* userInputQueue.next();
          if (next.done) {
            throw new Error("User input queue closed");
          }
          const message = next.value;

          setMessages((prev) => [...prev, { role: "user", content: message }]);
          setStatus({ text: "Waiting for assistant...", level: "pending" });
          setInputEnabled(false);

          return { message };
        },

        *showAssistantMessage({ input }) {
          setMessages((prev) => [...prev, { role: "assistant", content: input.message }]);
          // Protocol requires null (not undefined) for void results
          return null as unknown as void;
        },
      });

      const server = createProtocolServer(impl);

      yield* server.use({
        *receive() {
          return hostMessageQueue;
        },
        *send(msg: AgentMessage) {
          ws.send(JSON.stringify(msg));
        },
      });

      // Protocol server returned — host shut down
      setMessages((prev) => [...prev, { role: "system", content: "Host shut down" }]);
      setStatus({ text: "Host shut down", level: "disconnected" });
      setInputEnabled(false);
    });

    return () => {
      userInputQueueRef.current = null;
      task.halt();
    };
  }, [url]);

  const sendMessage = (text: string) => {
    userInputQueueRef.current?.add(text);
  };

  return { status, messages, inputEnabled, sendMessage };
}
