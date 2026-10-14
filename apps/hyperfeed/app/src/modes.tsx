/**
 * How private a message of yours was, as clients made before per-app
 * assignments sent it (the contract's `MESSAGE_MODES`). Which agent takes your
 * work is now set per app, in Settings → Agents; a message sent with a mode
 * still shows it.
 */
export type MessageMode = "private" | "public";

const MODE_LABELS: Record<MessageMode, string> = { private: "Private", public: "Public" };
const isMode = (m: unknown): m is MessageMode => m === "private" || m === "public";

/** On an older message of yours sent with a mode: how private it was. */
export function ModeChip({ mode }: { mode: string }) {
  if (!isMode(mode)) return null;
  return <span className={`mode-chip mode-${mode}`}>{MODE_LABELS[mode]}</span>;
}
