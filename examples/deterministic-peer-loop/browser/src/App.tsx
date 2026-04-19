import { useChat } from "./useChat.ts";
import { StatusBanner } from "./components/StatusBanner.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { MessageInput } from "./components/MessageInput.tsx";
import { ControlPanel } from "./components/ControlPanel.tsx";
import "./App.css";

export function App() {
  const {
    status,
    messages,
    inputEnabled,
    control,
    sendMessage,
    updateControl,
  } = useChat();

  return (
    <>
      <h1>Deterministic Peer Loop</h1>
      <StatusBanner text={status.text} level={status.level} />
      <div className="layout">
        <div className="main">
          <Transcript messages={messages} />
          <MessageInput enabled={inputEnabled} onSend={sendMessage} />
        </div>
        <aside className="sidebar">
          <ControlPanel
            control={control}
            disabled={status.level === "disconnected"}
            onUpdate={updateControl}
          />
        </aside>
      </div>
    </>
  );
}
