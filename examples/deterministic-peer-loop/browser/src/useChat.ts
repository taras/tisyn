import { useEffect, useRef, useState } from "react";
import { each, run } from "effection";
import { useWebSocket } from "@effectionx/websocket";

export type Speaker = "taras" | "opus" | "gpt";
export type PeerSpeaker = "opus" | "gpt";

export interface Status {
  text: string;
  level: "connected" | "disconnected" | "pending";
}

export interface TurnEntry {
  speaker: Speaker;
  content: string;
}

export interface LoopControl {
  paused: boolean;
  stopRequested: boolean;
  nextSpeakerOverride?: PeerSpeaker;
}

export interface ControlPatch {
  paused?: boolean;
  stopRequested?: boolean;
  nextSpeakerOverride?: PeerSpeaker | null;
}

const DEFAULT_CONTROL: LoopControl = {
  paused: false,
  stopRequested: false,
};

function getClientSessionId(): string {
  let id = localStorage.getItem("peerLoopSessionId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("peerLoopSessionId", id);
  }
  return id;
}

export function useChat(url = `ws://${window.location.host}`) {
  const [status, setStatus] = useState<Status>({
    text: "Disconnected",
    level: "disconnected",
  });
  const [messages, setMessages] = useState<TurnEntry[]>([]);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [control, setControl] = useState<LoopControl>(DEFAULT_CONTROL);
  const wsRef = useRef<{ send: (data: string) => void } | null>(null);

  useEffect(() => {
    const clientSessionId = getClientSessionId();

    const task = run(function* () {
      const ws = yield* useWebSocket<string>(url);
      wsRef.current = ws;

      setStatus({ text: "Connected — waiting for host...", level: "connected" });
      ws.send(JSON.stringify({ type: "connect", clientSessionId }));

      for (const event of yield* each(ws)) {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "loadChat":
            setMessages(msg.messages as TurnEntry[]);
            setStatus({ text: "Chat loaded", level: "connected" });
            break;

          case "elicit":
            setStatus({ text: msg.message || "Your turn", level: "connected" });
            setInputEnabled(true);
            break;

          case "showMessage":
            setMessages((prev) => [...prev, msg.entry as TurnEntry]);
            setStatus({ text: "Loop running", level: "pending" });
            break;

          case "setReadOnly":
            setStatus({ text: msg.reason, level: "disconnected" });
            setInputEnabled(false);
            break;

          case "controlSnapshot":
            setControl(msg.control as LoopControl);
            break;
        }

        yield* each.next();
      }

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
      setInputEnabled(false);
      setStatus({ text: "Waiting for peers...", level: "pending" });
      wsRef.current.send(JSON.stringify({ type: "userMessage", message: text }));
    }
  };

  const updateControl = (patch: ControlPatch) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "updateControl", patch }));
    }
  };

  return { status, messages, inputEnabled, control, sendMessage, updateControl };
}
