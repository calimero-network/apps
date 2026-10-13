import type { FeedItem, SettingsView } from "./generated/HyperfeedClient";

/**
 * Which of your agents a message of yours is for (the contract's
 * `MESSAGE_MODES`). Your agent's runtime maps each to a model: `chat` to a
 * private one for everyday work, `code` to one that works in repositories.
 */
export type MessageMode = "chat" | "code";

export const MODE_LABELS: Record<MessageMode, string> = { chat: "Private", code: "Code" };
const MODE_HINTS: Record<MessageMode, string> = {
  chat: "Your private agent: everyday questions and actions in your apps",
  code: "Your coding agent: repositories, branches and pull requests",
};

/** The modes this feed takes; none on a feed made before modes, which refuses a `mode` argument. */
export function feedModes(settings: SettingsView | null | undefined): MessageMode[] {
  return (settings?.message_modes ?? []).filter((m): m is MessageMode => m === "chat" || m === "code");
}

/** A chat keeps the mode of the last message of yours that had one; a chat with none is `chat`. */
export function chainMode(thread: FeedItem[]): MessageMode {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]!;
    if (m.kind === "message" && m.from === "you" && (m.mode === "chat" || m.mode === "code")) return m.mode;
  }
  return "chat";
}

/** Two buttons beside Send: which agent the next message goes to. */
export function ModePicker({
  modes,
  value,
  onChange,
  disabled,
}: {
  modes: MessageMode[];
  value: MessageMode;
  onChange: (mode: MessageMode) => void;
  disabled?: boolean;
}) {
  if (modes.length < 2) return null;
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Which agent">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          className={`mode-option ${value === m ? "on" : ""}`}
          title={MODE_HINTS[m]}
          disabled={disabled}
          onClick={() => onChange(m)}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

/** On a message of yours sent with a mode: which agent it went to. */
export function ModeChip({ mode }: { mode: string }) {
  if (mode !== "chat" && mode !== "code") return null;
  return <span className={`mode-chip mode-${mode}`}>{MODE_LABELS[mode]}</span>;
}
