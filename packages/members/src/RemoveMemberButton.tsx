import { useState, type ReactNode } from "react";

export interface RemoveMemberButtonProps {
  /** What to call the member in the prompt: their display name. */
  label: string;
  /**
   * Remove them. Reports its own failure (the button only resets): the caller
   * knows where its errors are shown, and a rejected promise from a click
   * handler would go nowhere.
   */
  onConfirm: () => Promise<unknown> | void;
  disabled?: boolean;
  /** Why it is disabled, as a tooltip. */
  title?: string;
  /** The question asked before removing. Defaults to "Remove {label}?". */
  prompt?: ReactNode;
  className?: string;
}

/**
 * A Remove button that asks first, inline.
 *
 * Inline rather than a dialog so it works inside any app's modal without a
 * second layer, and in tests without a portal. Removal revokes access the
 * member needs a new invitation to get back, so it is never one click.
 */
export function RemoveMemberButton({
  label,
  onConfirm,
  disabled = false,
  title,
  prompt,
  className,
}: RemoveMemberButtonProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        className={["cm-btn cm-btn--danger", className].filter(Boolean).join(" ")}
        aria-label={`Remove ${label}`}
        title={title}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        Remove
      </button>
    );
  }

  return (
    <span className="cm-confirm" role="group" aria-label={`Confirm removing ${label}`}>
      <span className="cm-confirm__text">{prompt ?? `Remove ${label}?`}</span>
      <button
        type="button"
        className="cm-btn cm-btn--danger-solid"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } catch {
            /* the caller reports it; see `onConfirm` */
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      <button type="button" className="cm-btn" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
