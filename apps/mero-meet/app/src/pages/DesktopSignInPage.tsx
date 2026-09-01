import { useCallback, useEffect, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { reloadApp } from "../lib/boot";
import { getBootNodeUrl } from "../lib/session";
import styles from "./DesktopSignInPage.module.css";

/**
 * Shown when we ARE inside the Calimero desktop app (or a dev browser session)
 * but the node has not authenticated us — see resolveBootScreen in lib/boot.ts.
 *
 * This exists because the auth guard used to render the *web* landing page here,
 * which told the user to go download the desktop app they had opened the window
 * from, and offered nothing to click. Every screen below has a way forward.
 *
 * The two failure modes look identical from React's side but need opposite
 * advice, so we probe the node's public health endpoint to tell them apart:
 *
 *   node unreachable  →  the window opened before merod finished starting (by
 *                        far the most common cause). Keep polling; the moment it
 *                        answers, reload so MeroProvider re-runs its auth probe
 *                        with the tokens already in the store.
 *   node reachable    →  our token is expired/rejected. Offer a real sign-in,
 *                        which is the node's own login page.
 */

const POLL_MS = 2000;

type Probe = "checking" | "node-down" | "node-up";

export default function DesktopSignInPage() {
  const { nodeUrl: meroNodeUrl, connectToNode, logout } = useMero();
  // MeroProvider clears its node URL when it rejects a callback or on logout, so
  // fall back to the one the desktop handed us in the SSO hash.
  const nodeUrl = meroNodeUrl ?? getBootNodeUrl();
  const [probe, setProbe] = useState<Probe>("checking");
  // Only a DOWN → UP transition earns an automatic reload. Reloading whenever the
  // node answers would loop forever on a node that is up but keeps rejecting our
  // token: `reloaded` is per-mount, so it cannot stop a loop that goes through a
  // page load. `sawDown` is what makes the reload one-shot in practice.
  const sawDown = useRef(false);
  const reloaded = useRef(false);

  useEffect(() => {
    if (!nodeUrl) {
      setProbe("node-up"); // nothing to poll; go straight to the sign-in advice
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let up = false;
      try {
        // Public, unauthenticated endpoint — a 200 means merod is serving.
        const resp = await fetch(`${nodeUrl}/auth/health`, { method: "GET" });
        up = resp.ok;
      } catch {
        up = false;
      }
      if (cancelled) return;
      if (up) {
        // The node finished starting after we'd already failed the auth probe:
        // re-run the boot so the stored tokens are validated against a live node.
        if (sawDown.current && !reloaded.current) {
          reloaded.current = true;
          reloadApp();
          return;
        }
        setProbe("node-up");
        return;
      }
      sawDown.current = true;
      setProbe("node-down");
      timer = setTimeout(poll, POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [nodeUrl]);

  const signIn = useCallback(() => {
    if (!nodeUrl) return;
    // Drop the rejected bundle first, or MeroProvider can treat the fresh
    // callback as "not newer than what we already hold" and ignore it.
    logout();
    connectToNode(nodeUrl);
  }, [nodeUrl, connectToNode, logout]);

  const waiting = probe !== "node-up";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.logo}>◉ Mero Meet</span>

        {waiting ? (
          <>
            <h1 className={styles.title}>Waiting for your Calimero node</h1>
            <p className={styles.body}>
              Mero Meet is connecting to the node the desktop app runs for you. This
              usually takes a few seconds after the node starts.
            </p>
            <div className={styles.status} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <span>Connecting{nodeUrl ? ` to ${nodeUrl}` : ""}…</span>
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Sign in to continue</h1>
            <p className={styles.body}>
              Your node is running but it didn&apos;t accept this window&apos;s
              session — it usually means the token expired or the node was reset.
              Signing in again fixes it.
            </p>
            {nodeUrl && <p className={styles.node}>{nodeUrl}</p>}
          </>
        )}

        <div className={styles.actions}>
          {!waiting && nodeUrl && (
            <button className={styles.primary} type="button" onClick={signIn}>
              Sign in
            </button>
          )}
          <button
            className={waiting ? styles.primary : styles.secondary}
            type="button"
            onClick={reloadApp}
          >
            Try again
          </button>
        </div>

        <p className={styles.hint}>
          Still stuck? Open the Calimero desktop app, check your node is running,
          then launch Mero Meet again.
        </p>
      </div>
    </div>
  );
}
