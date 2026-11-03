// Loader / status primitives, shared by the picker and the room list.
//
// The point of collecting them is consistency of MEANING, not of pixels: every
// pending action in this app shows a spinner *inside the button that started it*
// and a line of text naming the step in flight. Before this the pages had a single
// `busy` boolean, so clicking Invite greyed out Create, Join and every row, and all
// of them read "Working…" — which cannot distinguish "your click is being handled"
// from "something else locked the page".

import { type ReactNode } from "react";
import styles from "./ui.module.css";

/** Indeterminate spinner, sized and coloured from the surrounding text. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className={styles.spinner}
      role="status"
      aria-label={label ?? "Loading"}
      data-testid="spinner"
    />
  );
}

export interface ActionButtonProps {
  onClick: () => void;
  children: ReactNode;
  /** True while THIS action is in flight: shows a spinner and blocks re-entry. */
  pending?: boolean;
  /** Text shown in place of the label while pending. Defaults to the label. */
  pendingLabel?: string;
  /** Unavailable for a reason other than being in flight. */
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "normal" | "small";
  title?: string;
  testId?: string;
}

/**
 * A button that owns its own pending state.
 *
 * `pending` implies disabled — a second click on an in-flight action is the
 * easiest way to mint two invitations or create two rooms, and every flow here is
 * several round-trips long, which is plenty of time to double-click.
 */
export function ActionButton({
  onClick,
  children,
  pending = false,
  pendingLabel,
  disabled = false,
  variant = "primary",
  size = "normal",
  title,
  testId,
}: ActionButtonProps) {
  const cls = [
    styles.btn,
    variant === "secondary" ? styles.secondary : "",
    size === "small" ? styles.small : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending}
      title={title}
      data-testid={testId}
      data-pending={pending}
    >
      {pending && <Spinner />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

export type StatusTone = "pending" | "ok" | "error" | "info";

/**
 * One line of status. `pending` carries its own spinner so a status that appears
 * without a button (a background list refresh, a multi-step join) still reads as
 * motion rather than as a finished result.
 */
export function StatusNote({
  tone,
  children,
  testId,
}: {
  tone: StatusTone;
  children: ReactNode;
  testId?: string;
}) {
  const toneClass = {
    pending: styles.statusPending,
    ok: styles.statusOk,
    error: styles.statusError,
    info: styles.statusInfo,
  }[tone];
  return (
    <p
      className={`${styles.status} ${toneClass}`}
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      data-tone={tone}
    >
      {tone === "pending" && <Spinner />}
      <span>{children}</span>
    </p>
  );
}
