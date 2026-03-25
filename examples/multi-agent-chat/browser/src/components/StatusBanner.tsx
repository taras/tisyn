export function StatusBanner({ text, level }: { text: string; level: string }) {
  return <div className={`status ${level}`} role="status">{text}</div>;
}
