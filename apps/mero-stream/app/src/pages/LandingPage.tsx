import { ConnectButton } from "@calimero-network/mero-react";
import styles from "./LandingPage.module.css";

/**
 * Keys that survive pressing Connect: the node URL (so the modal can pre-fill
 * it) and this app's own display name. Everything else — token bundles, context
 * and namespace selections — is cleared so the auth flow starts clean.
 *
 * Lifted from mero-chat's `clearStorageForConnect`. The reason it exists: a stale
 * token bundle from a previous node otherwise survives into the new attempt, and
 * under single-use refresh (core#3083) reusing a refresh token revokes the whole
 * family — so the leftovers do not merely confuse the flow, they can lock the
 * account out of the node it belonged to.
 */
const PRESERVE_ON_CONNECT = new Set(["mero:node_url", "mero-stream:username"]);

function clearAuthStorageForConnect(): void {
  try {
    const keep: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !PRESERVE_ON_CONNECT.has(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) keep[key] = value;
    }
    localStorage.clear();
    sessionStorage.clear();
    for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  } catch {
    /* storage can be unavailable (private mode, blocked cookies) — not fatal */
  }
}

/**
 * The unauthenticated view, rendered by `RequireAuth`.
 *
 * It used to be a dead end: a "go install the desktop app" wall, shown because
 * `App` short-circuited on `APP_ENABLED` before the router mounted, so
 * mero-react's login was genuinely unreachable on the web. There was no way in
 * except arriving with a session already in the URL hash.
 *
 * Now it carries a real `ConnectButton`. That opens mero-react's LoginModal,
 * which probes the well-known local Calimero ports for a node and also takes a
 * URL typed by hand, then runs the normal username/password flow against it. The
 * desktop shell and the URL hash still work and skip this page entirely — they
 * are shortcuts now, not the only door.
 */
export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.logo}>◉ Mero Stream</span>
        <a
          className={styles.navCta}
          href="https://calimero.network"
          target="_blank"
          rel="noreferrer"
        >
          calimero.network
        </a>
      </header>

      <main className={styles.hero}>
        <div className={styles.badge}>Capacity probe · needs a node</div>
        <h1 className={styles.title}>
          Streaming media,
          <br />
          <span className={styles.accent}>through the contract.</span>
        </h1>
        <p className={styles.subtitle}>
          Mero Stream pushes video <em>over the Calimero contract</em> instead
          of WebRTC, to measure what a node can actually carry. Two routes:{" "}
          <strong>/stream</strong> runs a toy codec <em>inside</em> the WASM app
          at 64×48, and <strong>/live</strong> stores browser-encoded 480p H.264
          the app never interprets. It exists to produce numbers, not to ship
          video.
        </p>
        <p className={styles.subtitle}>
          You need a Calimero node to talk to — the app has no server of its
          own. Connect one below and it will find nodes running locally, or take
          a URL you type. Then sign in and create a stream.
        </p>

        <div className={styles.actions} data-testid="connect-actions">
          {/* Same shape as mero-chat's Login page: purge stale auth storage on
              pointer-down, BEFORE the SDK button starts the flow. A leftover
              token bundle from a previous node survives into the new attempt
              otherwise, and under single-use refresh (core#3083) reusing one can
              revoke the whole family. The node URL is deliberately kept so the
              modal can pre-fill it. */}
          <div onPointerDownCapture={clearAuthStorageForConnect}>
            <ConnectButton label="Connect a node" />
          </div>
          <a
            className={styles.secondary}
            href="https://github.com/calimero-network/apps/tree/main/apps/mero-stream"
            target="_blank"
            rel="noreferrer"
          >
            Source &amp; findings
          </a>
        </div>

        <p className={styles.hint}>
          No node yet? Run one with{" "}
          <a
            href="https://calimero.network/download"
            target="_blank"
            rel="noreferrer"
          >
            Calimero Desktop
          </a>
          , which also opens this app already signed in. Watching two peers
          needs two nodes — <code>make e2e-call</code> stands both up and drives
          the whole 480p call unattended.
        </p>
      </main>

      <footer className={styles.footer}>
        <span>Calimero · Mero Stream</span>
        <span>Task 3 · media over CRDT/DAG/gossip</span>
      </footer>
    </div>
  );
}
