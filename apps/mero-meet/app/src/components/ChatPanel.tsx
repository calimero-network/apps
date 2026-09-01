import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string) => void;
  onClose: () => void;
}

function timeOf(t: number): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** In-call chat, replicated over the Calimero contract (see useChat). */
export default function ChatPanel({ messages, selfId, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.title}>Chat</span>
        <button className={styles.close} onClick={onClose} title="Close chat" aria-label="Close chat">
          ✕
        </button>
      </header>

      <div className={styles.list} ref={listRef}>
        {messages.length === 0 && (
          <p className={styles.empty}>No messages yet. Say hello 👋</p>
        )}
        {messages.map((m) => {
          const mine = m.from === selfId;
          return (
            <div key={m.id} className={`${styles.msg} ${mine ? styles.mine : ""}`}>
              {!mine && <span className={styles.author}>{m.username || m.from.slice(0, 6)}</span>}
              <div className={styles.bubble}>{m.text}</div>
              <span className={styles.time}>{timeOf(m.createdAt)}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.composer}>
        <input
          className={styles.input}
          placeholder="Message the room…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          maxLength={4096}
        />
        <button className={styles.send} onClick={submit} disabled={!draft.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
