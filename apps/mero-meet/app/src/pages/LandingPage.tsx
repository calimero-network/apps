import styles from "./LandingPage.module.css";

/**
 * Web fallback. Mero Meet's media + node + auth all come from the Calimero
 * desktop app (tauri-app); there is no node or SSO on the plain web. So when
 * we're not running inside Tauri we block the call UI and point people at the
 * desktop app. Same role as the other mero apps' landing pages.
 */
export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.logo}>◉ Mero Meet</span>
        <a className={styles.navCta} href="https://calimero.network" target="_blank" rel="noreferrer">
          calimero.network
        </a>
      </header>

      <main className={styles.hero}>
        <div className={styles.badge}>Desktop app required</div>
        <h1 className={styles.title}>
          Private video calls,
          <br />
          <span className={styles.accent}>peer-to-peer.</span>
        </h1>
        <p className={styles.subtitle}>
          Mero Meet runs inside the Calimero desktop app. Signaling is carried by
          your private Calimero room — no signaling server, no account, no
          tracking. The video streams flow directly between participants.
        </p>

        <div className={styles.actions}>
          <a className={styles.primary} href="https://calimero.network/download" target="_blank" rel="noreferrer">
            Get Calimero Desktop
          </a>
          <a className={styles.secondary} href="https://calimero.network" target="_blank" rel="noreferrer">
            Learn more
          </a>
        </div>

        <p className={styles.hint}>
          Already have the desktop app? Open <strong>Mero Meet</strong> from your
          installed apps and pick a room to start a call.
        </p>
      </main>

      <section className={styles.steps}>
        <div className={styles.step}>
          <span className={styles.stepNum}>1</span>
          <h3>Install the desktop app</h3>
          <p>The Calimero desktop app runs your node and bundles everything a call needs.</p>
        </div>
        <div className={styles.step}>
          <span className={styles.stepNum}>2</span>
          <h3>Open Mero Meet</h3>
          <p>Launch it from your installed apps — it opens in its own window, already signed in.</p>
        </div>
        <div className={styles.step}>
          <span className={styles.stepNum}>3</span>
          <h3>Call your people</h3>
          <p>See who's in the room and start a call. Media goes directly peer-to-peer.</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Calimero · Mero Meet</span>
        <span>Decentralized signaling · WebRTC media</span>
      </footer>
    </div>
  );
}
