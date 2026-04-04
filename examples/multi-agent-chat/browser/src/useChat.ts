import { useEffect, useRef, useState } from "react";
import { each, run } from "effection";
import { useWebSocket } from "@effectionx/websocket";

export interface Status {
  text: string;
  level: "connected" | "disconnected" | "pending";
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

function getClientSessionId(): string {
  let id = localStorage.getItem("chatSessionId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("chatSessionId", id);
  }
  return id;
}

export function useChat(url = `ws://${window.location.host}`) {
  const [status, setStatus] = useState<Status>({ text: "Disconnected", level: "disconnected" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(false);
  const wsRef = useRef<{ send: (data: string) => void } | null>(null);

  useEffect(() => {
    const clientSessionId = getClientSessionId();

    const task = run(function* () {
      const ws = yield* useWebSocket<string>(url);
      wsRef.current = ws;

      setStatus({ text: "Connected — waiting for host...", level: "connected" });

      // Identify this browser to the host
      ws.send(JSON.stringify({ type: "connect", clientSessionId }));

      // Listen for host messages
      for (const event of yield* each(ws)) {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "loadChat":
            setMessages(
              msg.messages.map((m: { role: string; content: string }) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            );
            setStatus({ text: "Chat loaded", level: "connected" });
            break;

          case "elicit":
            setStatus({ text: msg.message || "Say something", level: "connected" });
            setInputEnabled(true);
            break;

          case "assistantMessage":
            setMessages((prev) => [...prev, { role: "assistant", content: msg.message }]);
            setStatus({ text: "Waiting for assistant...", level: "pending" });
            break;

          case "setReadOnly":
            setStatus({ text: msg.reason, level: "disconnected" });
            setInputEnabled(false);
            break;
        }

        yield* each.next();
      }

      // WebSocket closed
      setStatus({ text: "Disconnected", level: "disconnected" });
      setInputEnabled(false);
    });

    return () => {
      wsRef.current = null;
      task.halt();
    };
  }, [url]);

  const sendMessage = (text: string) => {
    if (wsRef.current) {
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInputEnabled(false);
      setStatus({ text: "Waiting for assistant...", level: "pending" });
      wsRef.current.send(JSON.stringify({ type: "userMessage", message: text }));
    }
  };

  return { status, messages, inputEnabled, sendMessage };
}
