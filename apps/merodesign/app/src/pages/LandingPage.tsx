import { useNavigate } from "react-router-dom";
import styles from "./LandingPage.module.css";

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>MeroDesign</span>
        <button className={styles.connectBtn} onClick={() => navigate("/login")}>
          Connect
        </button>
      </header>

      <main className={styles.hero}>
        <h1 className={styles.headline}>
          Collaborative design.<br />Your data, your nodes.
        </h1>
        <p className={styles.sub}>
          MeroDesign is a Figma-style design tool built on the Calimero p2p network.
          No central server. Your designs live on your infrastructure, shared only
          with the people you invite.
        </p>
        <button className={styles.cta} onClick={() => navigate("/login")}>
          Get started
        </button>
      </main>

      <section className={styles.features}>
        <div className={styles.feature}>
          <h3>Infinite canvas</h3>
          <p>Pan, zoom, draw shapes, add images and SVGs. Everything you expect from a design tool.</p>
        </div>
        <div className={styles.feature}>
          <h3>P2P sync</h3>
          <p>Changes sync in real-time across all team members' nodes. No vendor lock-in.</p>
        </div>
        <div className={styles.feature}>
          <h3>Team projects</h3>
          <p>Organize work into teams and projects. Public or restricted — you control access.</p>
        </div>
        <div className={styles.feature}>
          <h3>Export anywhere</h3>
          <p>Export your canvas as PNG or SVG. Your assets, your formats.</p>
        </div>
      </section>

      <section className={styles.faq}>
        <h2>FAQ</h2>
        <div className={styles.faqItem}>
          <strong>Where is my data stored?</strong>
          <p>On your own Calimero node. Nothing goes to a central server.</p>
        </div>
        <div className={styles.faqItem}>
          <strong>How do I invite teammates?</strong>
          <p>Create a project and share the invitation link. Invitees join via their own node.</p>
        </div>
        <div className={styles.faqItem}>
          <strong>Does it work offline?</strong>
          <p>Yes. Your node stores the full board state locally. Sync happens when peers are online.</p>
        </div>
        <div className={styles.faqItem}>
          <strong>What's the difference between a team and a project?</strong>
          <p>A team (namespace) is your workspace. Projects are individual boards inside it — each one is a Calimero context.</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>© 2026 Calimero Network</span>
      </footer>
    </div>
  );
}
