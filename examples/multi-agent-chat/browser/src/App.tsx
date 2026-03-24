import { useChat } from "./useChat.ts";
import { StatusBanner } from "./components/StatusBanner.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { MessageInput } from "./components/MessageInput.tsx";
import "./App.css";

export function App() {
  const { status, messages, inputEnabled, sendMessage } = useChat();

  return (
    <>
      <h1>Multi-Agent Chat</h1>
      <StatusBanner text={status.text} level={status.level} />
      <Transcript messages={messages} />
      <MessageInput enabled={inputEnabled} onSend={sendMessage} />
    </>
  );
}
