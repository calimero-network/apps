/**
 * MeroSign's front door.
 *
 * The app had no landing page. Unauthenticated, `App.tsx` rendered
 * `CalimeroConnectionRequired` — a card reading "Calimero Connection Required"
 * with a list of capabilities and an "Open Sidebar to Connect" button, inside
 * the app's own sidebar layout. It is a competent gate, and it is not an
 * explainer: it tells you what to click, never what MeroSign is or why the
 * signing happens on your own node.
 *
 * That component stays, and stays reachable — it is the right screen for
 * losing a connection mid-session. This page is what a first visitor sees.
 *
 * Structure follows mero-pixart / mero-stream / mero-design so the fleet reads
 * as one family.
 */
// `import React` is required, not decorative: this app's tsconfig uses the
// classic JSX transform ("jsx": "react"), so a file that omits it fails with
// 90x TS2686 "'React' refers to a UMD global". Every other component here
// imports it the same way.
import React, { useState } from "react";
import styles from "./LandingPage.module.css";

const REPO = "https://github.com/calimero-network/apps/tree/main/apps/mero-sign";

/** A still of the signatures view — what you cannot see before connecting. */
function AgreementPreview() {
  const rows: [string, string, string, boolean][] = [
    ["Mutual NDA — Acme ↔ Northwind", "2 of 2 signed", "sealed", true],
    ["Contractor agreement — R. Vance", "1 of 2 signed", "awaiting you", false],
    ["Data processing addendum", "0 of 3 signed", "sent", false],
  ];
  return (
    <div className={styles.preview}>
      <div className={styles.previewTop}>
        <span className={styles.previewBrand}>
          Mero<span>Sign</span>
        </span>
        <span className={styles.previewTabActive}>Agreements</span>
        <span className={styles.previewConnected}>● node connected</span>
      </div>
      {rows.map(([title, sigs, state, done]) => (
        <div key={title} className={styles.previewPost}>
          <div className={styles.previewVote} aria-hidden="true">
            <span className={done ? styles.previewArrowOn : styles.previewArrow}>
              {done ? "✓" : "◌"}
            </span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewTitle}>{title}</div>
            <div className={styles.previewMeta}>
              {sigs} · {state}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const FEATURES: [string, string, string][] = [
  ["✎", "Sign documents", "Upload a PDF, place signatures, and seal it. The document and its signatures live in a Calimero context."],
  ["⚿", "Signatures you can check", "Each signature is bound to the account that made it, so who signed what is verifiable rather than asserted."],
  ["⇄", "Shared P2P", "Counterparties join from their own nodes. The agreement replicates between you and nobody else."],
  ["◈", "Versioned", "Every revision is kept, so the document you signed stays retrievable exactly as it was."],
  ["⚑", "Invite-only", "Access follows namespace membership. There is no link that leaks a contract to whoever finds it."],
  ["⌂", "No server", "Your node stores the PDF and the signatures. There is no MeroSign backend holding your contracts."],
];

const STEPS: [string, string, string][] = [
  ["01", "Run your node", "Start a Calimero node. It stores the documents and their signatures."],
  ["02", "Connect", "Pick it from the list. No account, no email."],
  ["03", "Add an agreement", "Upload a PDF and place the signature fields."],
  ["04", "Invite the other side", "They join from their node, review, and sign."],
];

const FAQ: [string, string][] = [
  ["Where is my document stored?", "In a Calimero context on the nodes of its parties. No copy sits on a server in between."],
  ["What makes a signature verifiable?", "It is recorded against the signer's account id, not a device key — so it names a person, and the record is replicated to every party."],
  ["Do counterparties need an account?", "No. They run a node and join the namespace by invitation; the node's identity is the identity."],
  ["Can I still read an old version?", "Yes. Revisions are kept, so the exact document that was signed remains retrievable."],
  ["Is it open source?", "Yes — the app, the contract and the node are all on GitHub under MIT."],
];

export default function LandingPage({ onConnect }: { onConnect: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.root}>
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}>
            Mero<span>Sign</span>
          </span>
          <nav className={styles.nav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#how" className={styles.navLink}>How it works</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.headerCta} onClick={onConnect}>
            Connect a node
          </button>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
          {menuOpen && (
            <div className={styles.mobileMenu}>
              <a href="#features" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>Features</a>
              <a href="#how" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>How it works</a>
              <a href="#faq" className={styles.mobileItem} onClick={() => setMenuOpen(false)}>FAQ</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.mobileItem}>GitHub</a>
              <button className={styles.mobileCta} onClick={() => { setMenuOpen(false); onConnect(); }}>
                Connect a node
              </button>
            </div>
          )}
        </header>

        <div className={styles.glow1} aria-hidden="true" />
        <div className={styles.glow2} aria-hidden="true" />

        <main className={styles.hero}>
          <div className={styles.badge}>Open source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Sign agreements without
            <br />
            <span className={styles.headlineAccent}>handing them to anyone.</span>
          </h1>
          <p className={styles.sub}>
            MeroSign keeps a document and its signatures in a Calimero context
            shared between the parties. Every signature is bound to the account
            that made it, and nothing is stored on a server in between.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.ctaPrimary} onClick={onConnect}>
              Get started →
            </button>
            <a className={styles.ctaSecondary} href={REPO} target="_blank" rel="noopener noreferrer">
              View on GitHub →
            </a>
          </div>
        </main>
      </section>

      <section className={styles.previewSection}>
        <div className={styles.eyebrow}>What you get once a node is connected</div>
        <div className={styles.previewWrap}>
          <AgreementPreview />
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>What it does</h2>
          <p className={styles.sectionSub}>Document signing, with the custodian removed.</p>
          <div className={styles.grid}>
            {FEATURES.map(([icon, title, body]) => (
              <div key={title} className={styles.card}>
                <div className={styles.cardIcon} aria-hidden="true">{icon}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className={styles.sectionAlt}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <ol className={styles.steps}>
            {STEPS.map(([n, title, body]) => (
              <li key={n} className={styles.step}>
                <span className={styles.stepNum}>{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>FAQ</h2>
          <div className={styles.faq}>
            {FAQ.map(([q, a]) => (
              <div key={q} className={styles.faqItem}>
                <strong>{q}</strong>
                <p>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <span className={styles.logo}>
              Mero<span>Sign</span>
            </span>
            <p className={styles.footerTagline}>
              Document signing on the Calimero p2p network.
            </p>
          </div>
          <div className={styles.footerCols}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="#features" className={styles.footerLink}>Features</a>
              <a href="#how" className={styles.footerLink}>How it works</a>
              <a href="#faq" className={styles.footerLink}>FAQ</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Calimero</div>
              <a href="https://calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Website</a>
              <a href="https://docs.calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Docs</a>
              <a href="https://github.com/calimero-network/core" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Core node</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>This app</a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 Calimero Network</span>
          <span>MIT License</span>
        </div>
      </footer>
    </div>
  );
}
