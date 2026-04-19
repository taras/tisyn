import { useEffect, useRef } from "react";
import type { TurnEntry } from "../useChat.ts";

const SPEAKER_LABEL: Record<TurnEntry["speaker"], string> = {
  taras: "Taras",
  opus: "Opus",
  gpt: "GPT",
};

export function Transcript({ messages }: { messages: TurnEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="transcript" role="log" ref={ref}>
      {messages.map((msg, i) => (
        <div key={i} className={`message speaker-${msg.speaker}`}>
          <span className="speaker">{SPEAKER_LABEL[msg.speaker]}:</span>{" "}
          <span className="content">{msg.content}</span>
        </div>
      ))}
    </div>
  );
}
