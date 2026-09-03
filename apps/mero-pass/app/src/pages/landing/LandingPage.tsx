/**
 * The explainer, in the fleet's shape.
 *
 * `/` used to be `Authenticate`: a card of inline `style={{}}` objects with
 * gradient buttons, an emoji feature list and three links out. It carried the
 * copy but none of the structure the rest of the fleet's landing pages have,
 * and — like every other screen in this app — its layout classes were Tailwind
 * names against a stylesheet that has never contained Tailwind.
 *
 * Structure follows mero-pixart / mero-stream / mero-design so the apps read as
 * one family: hero, a preview of the real thing, features, how it works, FAQ,
 * footer. `Authenticate` stays, on `/login`, because it owns the ConnectButton.
 *
 * Copy comes from `constants/en.global.json`, which already held it.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import translations from "../../constants/en.global.json";
import styles from "./LandingPage.module.css";

const REPO = "https://github.com/calimero-network/apps/tree/main/apps/mero-pass";

/** A still of the vault list — the thing you cannot see before connecting. */
function VaultPreview() {
  const rows: [string, string, string][] = [
    ["AWS_SECRET_ACCESS_KEY", "production", "2h"],
    ["STRIPE_API_KEY", "billing", "1d"],
    ["DATABASE_URL", "staging", "3d"],
  ];
  return (
    <div className={styles.preview}>
      <div className={styles.previewTop}>
        <span className={styles.previewBrand}>
          Mero<span>Pass</span>
        </span>
        <span className={styles.previewTabActive}>Vault · core team</span>
        <span className={styles.previewConnected}>● node connected</span>
      </div>
      {rows.map(([name, tag, age]) => (
        <div key={name} className={styles.previewPost}>
          <div className={styles.previewVote} aria-hidden="true">
            <span className={styles.previewArrowOn}>⚿</span>
          </div>
          <div className={styles.previewBody}>
            <div className={styles.previewTitle}>{name}</div>
            <div className={styles.previewMeta}>
              {tag} · updated {age} ago · shared with 4 members
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const FEATURES: [string, string, string][] = [
  ["⚿", "Secrets in a vault", "A vault is a Calimero context. Names, values and tags live there — on your nodes, not in a service."],
  ["⇄", "Real-time sync", "A secret you add reaches every member over gossip, with no relay holding the plaintext."],
  ["◈", "Versioned", "Every write keeps its predecessor, so you can see what a value used to be and who changed it."],
  ["◑", "Audit trail", "Reads and writes are recorded against the account that made them, not a device key."],
  ["⚑", "Role-based access", "Namespace membership decides who can open a vault. You invite; nobody discovers it."],
  ["⌂", "Self-hosted", "Your node, your keys. There is no MeroPass server to trust or to breach."],
];

const STEPS: [string, string, string][] = [
  ["01", "Run your node", "Start a Calimero node. It stores the vault and its history."],
  ["02", "Connect", "Pick it from the list. No account, no email, no password to forget."],
  ["03", "Open a vault", "A vault appears for each context you are a member of."],
  ["04", "Share it", "Invite teammates to the namespace. Their nodes sync the vault P2P."],
];

const FAQ: [string, string][] = [
  ["Where are my secrets stored?", "In a Calimero context on the nodes of its members. No copy exists anywhere else."],
  ["Is there a master password?", "No. Access is your node's identity — the node holds the keys, so there is no passphrase to phish."],
  ["What is a vault, technically?", "One Calimero context. The namespace around it decides who may read it."],
  ["Can I see history?", "Yes. Values are versioned and every change is attributed to the account that made it."],
  ["How do I add someone?", "Invite them to the namespace. Membership is what grants access — a vault is never public."],
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();
  const [menuOpen, setMenuOpen] = useState(false);

  const enter = () => navigate(isAuthenticated ? "/home" : "/login");

  // ⚠️ Load-bearing for the desktop hand-off. The launcher opens this app at
  // `/`, which used to BE the connect screen and now is the explainer — so
  // without this, a window opened with a live session would sit on the
  // marketing page. `replace` keeps Back out of a redirect loop.
  useEffect(() => {
    if (isAuthenticated) navigate("/home", { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className={styles.root}>
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}>
            Mero<span>Pass</span>
          </span>
          <nav className={styles.nav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#how" className={styles.navLink}>How it works</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.headerCta} onClick={enter}>
            {isAuthenticated ? "Open vaults" : "Connect a node"}
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
              <button className={styles.mobileCta} onClick={() => { setMenuOpen(false); enter(); }}>
                {isAuthenticated ? "Open vaults" : "Connect a node"}
              </button>
            </div>
          )}
        </header>

        <div className={styles.glow1} aria-hidden="true" />
        <div className={styles.glow2} aria-hidden="true" />

        <main className={styles.hero}>
          <div className={styles.badge}>Open source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Shared secrets, kept
            <br />
            <span className={styles.headlineAccent}>on your own nodes.</span>
          </h1>
          <p className={styles.sub}>{translations.home.demoDescription}</p>
          <div className={styles.heroActions}>
            <button className={styles.ctaPrimary} onClick={enter}>
              {isAuthenticated ? "Open vaults →" : "Get started →"}
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
          <VaultPreview />
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>What it does</h2>
          <p className={styles.sectionSub}>{translations.auth.description.subtitle}.</p>
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
              Mero<span>Pass</span>
            </span>
            <p className={styles.footerTagline}>
              {translations.auth.description.subtitle} on the Calimero p2p network.
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
              <a href="https://calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>{translations.home.website}</a>
              <a href="https://docs.calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>{translations.home.documentation}</a>
              <a href="https://github.com/calimero-network/core" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Core node</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>{translations.home.github}</a>
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
