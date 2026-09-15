// ── "You cannot bring media into a call from this window" ─────────────────────
//
// `lib/media.ts` has always been able to answer this question — that is what
// `localMediaUnavailableReason()` is for, and its own docstring says it exists
// "so a screen can say so before the user commits to joining a call that cannot
// carry their media". Nothing ever called it outside tests.
//
// So the only consumer was `acquireLocalMedia()` inside `WebRtcMesh.start()`,
// which runs AFTER the user has named themselves, entered the room and pressed
// the button. The diagnosis was correct and arrived too late to act on:
//
//     This window has no camera or microphone API — navigator.mediaDevices is
//     missing, so the webview never published it.
//
// This component moves that sentence to the lobby, where there is still a
// choice to make, and attaches the two actions that resolve it.

type Props = {
  /** The message from `localMediaUnavailableReason()`. */
  reason: string;
};

/**
 * Hand the current room off to a real browser.
 *
 * A plain anchor, not `window.open`: in the desktop webview a scripted popup is
 * routinely suppressed with no error, whereas a target=_blank navigation is
 * handed to the OS. Copy is offered alongside because it is the one path that
 * cannot fail — if the anchor is swallowed, the link is still on the clipboard.
 */
export default function MediaUnavailableNotice({ reason }: Props) {
  const href = typeof window === "undefined" ? "" : window.location.href;

  const copy = () => {
    void navigator.clipboard?.writeText(href).catch(() => {
      /* clipboard denied — the link is visible in the anchor's href anyway */
    });
  };

  return (
    <section
      role="status"
      data-testid="media-unavailable"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px solid var(--warning-border, #8a6d1f)",
        background: "var(--warning-bg, rgba(217, 164, 6, 0.12))",
        color: "var(--fg, inherit)",
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      <span>{reason}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a
          data-testid="media-open-in-browser"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            background: "var(--accent, #4f8cff)",
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Open in browser
        </a>
        <button
          data-testid="media-copy-link"
          onClick={copy}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "1px solid var(--border, #3a4250)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Copy room link
        </button>
      </div>
    </section>
  );
}
