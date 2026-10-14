import type { FeedItem, SettingsView } from "./generated/HyperfeedClient";

/**
 * How private a message of yours is (the contract's `MESSAGE_MODES`), which
 * says which of your agents takes it. Your agent's runtime maps each to an
 * agent: `private` to one whose model runs where no operator can read it,
 * `public` to any you configured (one with your repositories, say).
 */
export type MessageMode = "private" | "public";

const MODES: MessageMode[] = ["private", "public"];
export const MODE_LABELS: Record<MessageMode, string> = { private: "Private", public: "Public" };
const MODE_HINTS: Record<MessageMode, string> = {
  private: "Your private agent: its model runs where no one, Calimero included, can read what you say",
  public: "Your other agent: the one you set up for everything else, such as code",
};
const isMode = (m: unknown): m is MessageMode => MODES.includes(m as MessageMode);

/** The modes this feed takes; none on a feed made before modes, which refuses a `mode` argument. */
export function feedModes(settings: SettingsView | null | undefined): MessageMode[] {
  return (settings?.message_modes ?? []).filter(isMode);
}

/** A chat keeps the mode of the last message of yours that had one; a chat with none is `private`. */
export function chainMode(thread: FeedItem[]): MessageMode {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]!;
    if (m.kind === "message" && m.from === "you" && isMode(m.mode)) return m.mode;
  }
  return "private";
}

/** Two buttons beside Send: how private the next message is, and so which agent takes it. */
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
    <div className="mode-picker" role="radiogroup" aria-label="How private">
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

/** On a message of yours sent with a mode: how private it was. */
export function ModeChip({ mode }: { mode: string }) {
  if (!isMode(mode)) return null;
  return <span className={`mode-chip mode-${mode}`}>{MODE_LABELS[mode]}</span>;
}
