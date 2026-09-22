import type { CSSProperties } from "react";

import type { InviteState } from "./useInviteRedemption";

export interface InviteStatusBannerProps {
  /** Usually `useInviteRedemption(...).state`. */
  state: InviteState;
  /** What the namespace is called in this app: "team", "space", "vault". */
  noun?: string;
  /** Wire to `.retry` — shown only for a failure worth retrying. */
  onRetry?: () => void;
  /** Wire to `.dismiss`. */
  onDismiss?: () => void;
  /** Escape hatches for apps with their own design system. */
  className?: string;
  style?: CSSProperties;
}

/**
 * Inline-styled for the same reason `JoinSyncBanner` is: the apps in this
 * monorepo do not share a CSS stack — Tailwind, CSS modules and plain
 * stylesheets are all represented — so anything class-based renders unstyled in
 * most of them. Colours come from CSS custom properties with literal fallbacks,
 * so an app that defines them gets its own palette and one that does not still
 * gets something legible in both themes.
 */
export function InviteStatusBanner({
  state,
  noun = "team",
  onRetry,
  onDismiss,
  className,
  style,
}: InviteStatusBannerProps) {
  if (state.stage === "idle") return null;

  const failed = state.stage === "failed";
  const named =
    "teamName" in state && state.teamName
      ? `“${state.teamName}”`
      : `this ${noun}`;

  const text =
    state.stage === "joining"
      ? `Joining ${named}…`
      : state.stage === "joined"
        ? `Joined ${named}. Syncing…`
        : state.stage === "already-member"
          ? `You are already in ${named}.`
          : state.message;

  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.625rem 0.875rem",
        borderRadius: "0.5rem",
        border: `1px solid ${
          failed
            ? "var(--color-danger-border, rgba(220,38,38,0.35))"
            : "var(--color-border, rgba(127,127,127,0.3))"
        }`,
        background: failed
          ? "var(--color-danger-surface, rgba(220,38,38,0.08))"
          : "var(--color-surface-2, rgba(127,127,127,0.08))",
        color: failed
          ? "var(--color-danger-ink, #b91c1c)"
          : "var(--color-text, inherit)",
        font: "inherit",
        fontSize: "0.875rem",
        ...style,
      }}
    >
      {state.stage === "joining" || state.stage === "joined" ? (
        <Spinner />
      ) : (
        <span aria-hidden="true">{failed ? "⚠" : "✓"}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {failed && state.retryable && onRetry ? (
        <button type="button" onClick={onRetry} style={linkButton}>
          Try again
        </button>
      ) : null}
      {onDismiss && state.stage !== "joining" ? (
        <button
          type="button"
          onClick={onDismiss}
          style={linkButton}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

const linkButton: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  opacity: 0.85,
};

/**
 * A CSS animation needs a stylesheet, and this package deliberately ships none,
 * so the keyframes ride along in a scoped <style> the first time one renders.
 */
function Spinner() {
  return (
    <>
      <style>{`@keyframes calimero-invite-spin{to{transform:rotate(360deg)}}`}</style>
      <span
        aria-hidden="true"
        style={{
          width: "0.875rem",
          height: "0.875rem",
          flex: "none",
          borderRadius: "50%",
          border: "2px solid currentColor",
          borderTopColor: "transparent",
          opacity: 0.7,
          animation: "calimero-invite-spin 0.8s linear infinite",
        }}
      />
    </>
  );
}
