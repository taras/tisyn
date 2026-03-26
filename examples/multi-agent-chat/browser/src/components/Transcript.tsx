import { useEffect, useRef } from "react";
import type { Message } from "../useChat.ts";

function formatMessage(msg: Message): string {
  if (msg.role === "user") return `You: ${msg.content}`;
  if (msg.role === "assistant") return `Assistant: ${msg.content}`;
  return msg.content;
}

export function Transcript({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="transcript" role="log" ref={ref}>
      {messages.map((msg, i) => (
        <div key={i} className={`message ${msg.role}`}>
          {formatMessage(msg)}
        </div>
      ))}
    </div>
  );
}
