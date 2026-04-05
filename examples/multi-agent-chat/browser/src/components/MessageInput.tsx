import { useEffect, useRef, useState } from "react";

export function MessageInput({
  enabled,
  onSend,
}: {
  enabled: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enabled) {
      inputRef.current?.focus();
    }
  }, [enabled]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !enabled) {
      return;
    }
    setText("");
    onSend(trimmed);
  };

  return (
    <div className="input-area">
      <input
        ref={inputRef}
        className="message-input"
        type="text"
        aria-label="Message"
        placeholder="Type a message..."
        disabled={!enabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSend();
          }
        }}
      />
      <button disabled={!enabled} onClick={handleSend}>
        Send
      </button>
    </div>
  );
}
