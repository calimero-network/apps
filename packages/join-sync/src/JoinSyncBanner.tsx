import type { CSSProperties, ReactNode } from "react";

export interface JoinSyncBannerProps {
  /** Usually `useJoinSync(...).isSyncing`. Renders nothing when false. */
  show: boolean;
  /** What is arriving, in the app's own words: "documents", "vaults", "sheets". */
  what?: string;
  /** Wire to `useJoinSync(...).dismiss` for a "show me anyway" escape. */
  onDismiss?: () => void;
  /** Escape hatches for apps with their own design system. */
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Deliberately inline-styled rather than using a stylesheet or utility classes.
 *
 * The apps in this monorepo do not share a CSS stack — Tailwind, CSS modules
 * and plain stylesheets are all represented — so anything class-based would
 * render unstyled in most of them. Inline styles are the only thing that looks
 * the same everywhere, and `className`/`style` are there for apps that want to
 * take it over. Colours come from CSS custom properties with literal
 * fallbacks, so an app that defines them gets its own palette for free and one
 * that does not still gets something legible in both themes.
 */
export function JoinSyncBanner({
  show,
  what = "data",
  onDismiss,
  className,
  style,
  children,
}: JoinSyncBannerProps) {
  if (!show) return null;

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
        border: "1px solid var(--join-sync-border, rgba(127,127,127,0.28))",
        background: "var(--join-sync-bg, rgba(127,127,127,0.08))",
        color: "var(--join-sync-fg, inherit)",
        font: "inherit",
        fontSize: "0.875rem",
        lineHeight: 1.4,
        ...style,
      }}
    >
      <Spinner />
      <span style={{ flex: 1 }}>
        {children ?? (
          <>
            Joined. Syncing {what} from peers&hellip;{" "}
            <span style={{ opacity: 0.75 }}>
              This can take a moment on a cold connection.
            </span>
          </>
        )}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            font: "inherit",
            fontSize: "0.8125rem",
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            opacity: 0.75,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Show anyway
        </button>
      )}
    </div>
  );
}

/**
 * An inline SVG rather than a CSS-class spinner, for the same reason as above —
 * and `<animateTransform>` rather than a keyframe, because injecting a
 * `@keyframes` rule from a shared component would collide across apps.
 */
function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.85 }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 1.5A6.5 6.5 0 0 1 14.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 8 8"
          to="360 8 8"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
