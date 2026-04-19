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
    readOnlyReason,
    sendMessage,
    updateControl,
  } = useChat();

  return (
    <>
      <h1>Deterministic Peer Loop</h1>
      <StatusBanner
        text={readOnlyReason ?? status.text}
        level={readOnlyReason ? "disconnected" : status.level}
      />
      <div className="layout">
        <div className="main">
          <Transcript messages={messages} />
          <MessageInput enabled={inputEnabled} onSend={sendMessage} />
        </div>
        <aside className="sidebar">
          <ControlPanel
            control={control}
            disabled={readOnlyReason !== null}
            onUpdate={updateControl}
          />
        </aside>
      </div>
    </>
  );
}
