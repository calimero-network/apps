import styles from "./LandingPage.module.css";

/**
 * Web fallback. Mero Stream's node + auth all come from the Calimero desktop
 * app (tauri-app); there is no node or SSO on the plain web, and the whole app
 * is a desktop capacity probe. So when we're not running inside Tauri we block
 * the capture UI and point people at the desktop app.
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
        <div className={styles.badge}>Desktop capacity probe</div>
        <h1 className={styles.title}>
          Streaming media,
          <br />
          <span className={styles.accent}>through the contract.</span>
        </h1>
        <p className={styles.subtitle}>
          Mero Stream is a diagnostic that pushes downscaled webcam frames
          <em> over the Calimero contract</em> — the WASM logic encodes each
          frame, the delta gossips, and a peer decodes it back to pixels. No
          WebRTC. It exists to measure the node's ceiling, not to ship video. It
          runs inside the Calimero desktop app.
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
            href="https://calimero.network"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </a>
        </div>

        <p className={styles.hint}>
          Already have the desktop app? Open <strong>Mero Stream</strong> from
          your installed apps and pick a stream to start the probe.
        </p>
      </main>

      <footer className={styles.footer}>
        <span>Calimero · Mero Stream</span>
        <span>Task 3 · media over CRDT/DAG/gossip</span>
      </footer>
    </div>
  );
}
