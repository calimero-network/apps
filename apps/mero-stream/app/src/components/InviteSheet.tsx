import { type ReactNode, useCallback, useMemo, useState } from "react";
import { shareableInvitation } from "../lib/inviteLink";
import styles from "./InviteSheet.module.css";

/**
 * An invitation: a shareable link, a desktop link, and the raw code.
 *
 * The link is the object you send, and it is built by the platform SDK — so it is
 * the same shape mero-chat-pwa produces,
 * `https://links.calimero.network/<slug>/join?invitation=…`. That is what makes
 * one string work in three places: the web app, the installed PWA, and the
 * desktop launcher on a machine that has claimed this app.
 *
 * The other two are secondary and each earns its place:
 *
 *   * **Desktop link** (`calimero://…`) hands the invitation straight to the
 *     installed desktop app. The SDK deliberately does not build these — the
 *     custom scheme is a transport between launcher and app, not something that
 *     survives being pasted into a chat window — so it is a separate affordance
 *     rather than the thing you share.
 *   * **The code** is the cross-app format `lib/inviteCodec` produces, which
 *     mero-chat and mero-blocks also read. Behind a disclosure, because it is
 *     ~380 characters of base58 and does not belong on screen by default.
 */
export default function InviteSheet({
  code,
  scope,
  hint,
}: {
  code: string;
  /** What the invitation grants — "Whole stream · Foo" or "Room · Bar". */
  scope: string;
  hint?: ReactNode;
}) {
  const [copied, setCopied] = useState<"link" | "deep" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const share = useMemo(() => shareableInvitation(code), [code]);

  const copy = useCallback(
    async (value: string, which: "link" | "deep" | "code") => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(which);
        setError(null);
      } catch {
        // Clipboard access is denied outside a secure context and in some
        // embedded webviews. Say what to do instead of failing silently.
        setError(
          "Could not reach the clipboard — select the text and copy it.",
        );
      }
    },
    [],
  );

  // `navigator.share` needs a user gesture and only exists on some platforms; a
  // cancelled share sheet rejects with AbortError, which is not a failure.
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: "Join my Mero Stream call",
        text: `Join ${scope}`,
        url: share.link,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      await copy(share.link, "link");
    }
  }, [share, scope, copy]);

  return (
    <section className={styles.sheet} data-testid="invite-box">
      <div className={styles.head}>
        <h3 className={styles.title}>Invitation link</h3>
        <span className={styles.scope} data-testid="invite-scope">
          {scope}
        </span>
      </div>

      <div className={styles.linkRow}>
        <input
          className={styles.link}
          value={share.link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invitation link"
          data-testid="invite-link"
        />
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => void copy(share.link, "link")}
          data-testid="invite-copy"
        >
          {copied === "link" ? "Copied ✓" : "Copy link"}
        </button>
        {canShare && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void nativeShare()}
            data-testid="invite-share"
          >
            Share…
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {hint && <p className={styles.hint}>{hint}</p>}

      <details className={styles.disclosure}>
        <summary className={styles.summary}>Other ways to send it</summary>

        <div className={styles.codeRow}>
          <input
            className={styles.code}
            value={share.deepLink}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Desktop link"
            data-testid="invite-deep-link"
          />
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void copy(share.deepLink, "deep")}
            data-testid="invite-copy-deep-link"
          >
            {copied === "deep" ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p className={styles.hint}>
          <strong>Desktop link.</strong> Hands the invitation straight to the
          installed desktop app. Not for chat windows — <code>calimero://</code>{" "}
          is a transport between the launcher and an app, and most places will
          not make it clickable.
        </p>

        <div className={styles.codeRow}>
          <input
            className={styles.code}
            value={share.code}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Invitation code"
            data-testid="invite-code"
          />
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void copy(share.code, "code")}
            data-testid="invite-copy-code"
          >
            {copied === "code" ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p className={styles.hint}>
          <strong>Raw code.</strong> The format every mero app reads — paste it
          into <em>Join</em> here, or into mero-chat. Use this if the link does
          not survive however you are sending it.
        </p>
      </details>
    </section>
  );
}
