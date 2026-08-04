import styles from "./LandingPage.module.css";

/**
 * Shown when no session is available — i.e. the app was opened without a node URL
 * and access token in the URL hash, and not inside the desktop shell.
 *
 * It is NOT a "desktop only" wall, which is what this page used to say. The app
 * runs fine on the plain web (PR #5: direct HTTP + SSE to the node, no Tauri
 * proxy on any path, ordinary bearer token). What it cannot do is invent a node
 * to talk to — so this page explains where a session comes from instead of
 * telling people to go install something.
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
          There is nothing to install. This page just needs a node and a
          session, which arrive in the URL — open Mero Stream from the Calimero
          desktop app or your apps registry and it lands here authenticated.
        </p>

        <div className={styles.actions}>
          <a
            className={styles.primary}
            href="https://calimero.network/download"
            target="_blank"
            rel="noreferrer"
          >
            Get Calimero Desktop
          </a>
          <a
            className={styles.secondary}
            href="https://github.com/calimero-network/mero-stream"
            target="_blank"
            rel="noreferrer"
          >
            Source & findings
          </a>
        </div>

        <p className={styles.hint}>
          Running your own nodes? <code>make e2e-call</code> drives the whole
          two-node 480p call — both nodes, the app install, the invitation and
          two browsers — unattended.
        </p>
      </main>

      <footer className={styles.footer}>
        <span>Calimero · Mero Stream</span>
        <span>Task 3 · media over CRDT/DAG/gossip</span>
      </footer>
    </div>
  );
}
