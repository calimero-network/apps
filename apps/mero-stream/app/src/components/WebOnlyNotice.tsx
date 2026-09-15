// ── Mero Stream does not run in the desktop window ────────────────────────────
//
// It used to render there, which was the problem: the UI came up, a stream could
// be created, and only the media never arrived. Live video is the entire app, so
// a window that cannot carry it is not a degraded Mero Stream — it is a
// convincing imitation of one.
//
// The cause is the same as mero-meet's, and it is not ours to fix: the desktop
// is WKWebView via wry, and the Media Capture API is simply not published there
// (`navigator.mediaDevices` is absent, so no amount of permission granting
// brings it back). Rather than let someone discover that three screens in, the
// app says so on open and hands them the link.

/**
 * Full-page stop, shown in place of the app when running inside the desktop
 * shell.
 *
 * The action is a plain anchor, not `window.open`: in the desktop webview a
 * scripted popup is routinely suppressed with no error, whereas a target=_blank
 * navigation is handed to the OS. Copy sits beside it because it is the one
 * path that cannot fail.
 */
export default function WebOnlyNotice() {
  const href = typeof window === "undefined" ? "" : window.location.href;

  const copy = () => {
    void navigator.clipboard?.writeText(href).catch(() => {
      /* clipboard denied — the link is still visible in the anchor */
    });
  };

  return (
    <main
      data-testid="web-only-notice"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 28,
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#0b0e14",
        color: "#e6edf3",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
        Mero Stream runs in your browser
      </h1>
      <p style={{ margin: 0, maxWidth: 460, fontSize: 15, lineHeight: 1.6, color: "#a9b6c4" }}>
        This desktop window has no camera or microphone API, so a stream opened
        here would have no video or audio to publish. Open Mero Stream in Chrome
        or Safari and everything works, including invites you already have.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <a
          data-testid="web-only-open-in-browser"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "11px 22px",
            borderRadius: 7,
            background: "#4f8cff",
            color: "#fff",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Open in browser
        </a>
        <button
          data-testid="web-only-copy-link"
          onClick={copy}
          style={{
            padding: "11px 22px",
            borderRadius: 7,
            border: "1px solid #3a4250",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Copy link
        </button>
      </div>
    </main>
  );
}
