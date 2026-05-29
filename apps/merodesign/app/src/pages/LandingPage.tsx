import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import styles from "./LandingPage.module.css";

const LOOP_MS = 7000;

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add(styles.visible); obs.disconnect(); } },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function AppPreview({ animKey }: { animKey: number }) {
  const canvasItems = [
    { cls: styles.elRect,    style: { top: "12%",  left: "8%",  animationDelay: "0.5s" } },
    { cls: styles.elRect2,   style: { top: "12%",  left: "44%", animationDelay: "0.7s" } },
    { cls: styles.elCircle,  style: { top: "52%",  left: "58%", animationDelay: "0.9s" } },
    { cls: styles.elOrange,  style: { top: "58%",  left: "8%",  animationDelay: "1.0s" } },
    { cls: styles.elLine,    style: { top: "78%",  left: "8%",  animationDelay: "1.1s" } },
    { cls: styles.elText,    style: { top: "36%",  left: "10%", animationDelay: "1.2s" } },
    { cls: styles.elBadge,   style: { top: "80%",  left: "44%", animationDelay: "1.3s" } },
  ];

  const propRows = [
    ["Fill",    "#4F8EF7"],
    ["Stroke",  "none"],
    ["Opacity", "100%"],
    ["W",       "240 px"],
    ["H",       "140 px"],
    ["X",       "80 px"],
    ["Y",       "56 px"],
  ];

  return (
    <div key={animKey} className={styles.previewShell}>
      {/* Toolbar strip */}
      <div className={styles.previewToolbar}>
        <div className={styles.previewDot} style={{ background: "#ff5f56" }} />
        <div className={styles.previewDot} style={{ background: "#ffbd2e" }} />
        <div className={styles.previewDot} style={{ background: "#27c93f" }} />
        <span className={styles.previewToolbarLogo}><Logo size={14} color="#fff" /> MeroDesign</span>
        {["V","R","O","T","→"].map((t) => (
          <div key={t} className={styles.previewTool}>{t}</div>
        ))}
      </div>

      <div className={styles.previewBody}>
        {/* Sidebar */}
        <div className={styles.previewSidebar}>
          <div className={styles.previewSidebarTitle}>Projects</div>
          {["Homepage", "Dashboard", "Mobile App", "Onboarding"].map((name, i) => (
            <div
              key={name}
              className={`${styles.previewSidebarItem} ${i === 1 ? styles.sidebarActive : ""}`}
              style={{ animationDelay: `${0.3 + i * 0.12}s` }}
            >
              <span className={styles.sidebarDot} />
              {name}
            </div>
          ))}
          <div className={styles.previewSidebarSep} />
          <div className={styles.previewSidebarTitle} style={{ marginTop: 8 }}>Members</div>
          {["Alice", "Bob"].map((name, i) => (
            <div key={name} className={styles.previewMember} style={{ animationDelay: `${0.8 + i * 0.1}s` }}>
              <div className={styles.previewAvatar}>{name[0]}</div>
              {name}
            </div>
          ))}
        </div>

        {/* Canvas */}
        <div className={styles.previewCanvas}>
          {canvasItems.map(({ cls, style }, i) => (
            <div key={i} className={`${styles.previewEl} ${cls}`} style={style} />
          ))}
          {/* Animated selection that moves between elements */}
          <div className={styles.elSelection} />
          {/* Cursor */}
          <div className={styles.elCursor} />
        </div>

        {/* Properties */}
        <div className={styles.previewProps}>
          <div className={styles.previewPropsTitle}>Properties</div>
          {propRows.map(([label, val], i) => (
            <div key={label} className={styles.propRow} style={{ animationDelay: `${0.6 + i * 0.08}s` }}>
              <span className={styles.propLabel}>{label}</span>
              <span className={styles.propVal}>{val}</span>
            </div>
          ))}
          <div className={styles.propSep} />
          <div className={styles.previewPropsTitle} style={{ marginTop: 10 }}>Fill</div>
          <div className={styles.colorSwatch} />
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [animKey, setAnimKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const featuresRef = useReveal();
  const previewRef = useReveal();
  const howRef = useReveal();
  const faqRef = useReveal();

  useEffect(() => {
    const id = setInterval(() => setAnimKey((k) => k + 1), LOOP_MS);
    return () => clearInterval(id);
  }, []);

  function closeMenu() { setMenuOpen(false); }

  return (
    <div className={styles.root}>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className={styles.heroSection}>
        {/* Sticky header */}
        <header className={styles.header}>
          <span className={styles.logo}><Logo size={26} /> MeroDesign</span>
          <nav className={styles.headerNav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href="https://github.com/calimero-network" target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.connectBtn} onClick={() => navigate("/login")}>
            Connect to node
          </button>
          {/* Hamburger — mobile only */}
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
          {/* Mobile dropdown */}
          {menuOpen && (
            <div className={styles.mobileMenu}>
              <a href="#features" className={styles.mobileMenuItem} onClick={closeMenu}>Features</a>
              <a href="#faq" className={styles.mobileMenuItem} onClick={closeMenu}>FAQ</a>
              <a href="https://github.com/calimero-network" target="_blank" rel="noopener noreferrer" className={styles.mobileMenuItem} onClick={closeMenu}>GitHub</a>
              <button className={styles.mobileMenuCta} onClick={() => { navigate("/login"); closeMenu(); }}>
                Connect to node
              </button>
            </div>
          )}
        </header>

        {/* Animated blurred background circles */}
        <div className={styles.bgCircle1} />
        <div className={styles.bgCircle2} />
        <div className={styles.bgCircle3} />

        <main className={styles.hero}>
          <div className={styles.heroBadge}>Open-source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Collaborative design.<br />
            <span className={styles.headlineAccent}>Your data, your nodes.</span>
          </h1>
          <p className={styles.sub}>
            MeroDesign is a Figma-style design tool built on the Calimero p2p
            network. No central server. Your designs live on your infrastructure,
            shared only with the people you invite.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.cta} onClick={() => navigate("/login")}>
              Get started
            </button>
            <a
              className={styles.ctaSecondary}
              href="https://github.com/calimero-network"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub →
            </a>
          </div>
        </main>
      </section>

      {/* ── Preview ───────────────────────────────────────────────────── */}
      <section className={styles.previewSection}>
        <div className={styles.previewLabel}>See it in action</div>
        <div
          ref={previewRef}
          className={`${styles.previewWrap} ${styles.reveal}`}
        >
          <AppPreview animKey={animKey} />
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section id="features" className={styles.featuresSection}>
        <div
          ref={featuresRef}
          className={`${styles.featuresInner} ${styles.reveal}`}
        >
          <h2 className={styles.sectionTitle}>Everything a design tool needs</h2>
          <p className={styles.sectionSub}>Built for teams that care about who owns their data.</p>
          <div className={styles.featuresGrid}>
            {[
              { icon: "⬡", title: "Infinite canvas",   body: "Pan, zoom, draw shapes, add images and SVGs. Everything you expect from a design tool." },
              { icon: "⇄", title: "P2P real-time sync", body: "Changes propagate instantly across all peers. No central relay, no vendor lock-in." },
              { icon: "◫", title: "Team workspaces",    body: "Organise work into teams and projects. Invite with a link — no accounts needed." },
              { icon: "↗", title: "Export anywhere",    body: "Export your canvas as PNG or SVG whenever you need it." },
              { icon: "⚿", title: "Self-sovereign",     body: "Your node, your keys, your data. Zero telemetry, zero central storage." },
              { icon: "◉", title: "Layer control",      body: "Full z-order management — bring to front, send to back, reorder freely." },
            ].map(({ icon, title, body }, i) => (
              <div key={title} className={styles.featureCard} style={{ animationDelay: `${i * 0.08}s` }}>
                <div className={styles.featureIcon}>{icon}</div>
                <h3>{title}</h3>
                <p>{body}</p>
                <div className={styles.featureGlow} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section className={styles.howSection}>
        <div
          ref={howRef}
          className={`${styles.howInner} ${styles.reveal}`}
        >
          <h2 className={styles.sectionTitleLight}>How it works</h2>
          <div className={styles.howSteps}>
            {[
              { n: "01", title: "Run your node",    body: "Start a local Calimero node with `make dev`. Takes under a minute." },
              { n: "02", title: "Connect the app",  body: "Open the app, enter your node URL. You're in — no account, no email." },
              { n: "03", title: "Create a board",   body: "Spin up a design board inside your workspace. Draw, annotate, upload." },
              { n: "04", title: "Invite your team", body: "Share an invite. Teammates join from their own nodes. Data syncs P2P." },
            ].map(({ n, title, body }) => (
              <div key={n} className={styles.howStep}>
                <div className={styles.howNum}>{n}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section id="faq" className={styles.faqSection}>
        <div
          ref={faqRef}
          className={`${styles.faqInner} ${styles.reveal}`}
        >
          <h2 className={styles.sectionTitle}>FAQ</h2>
          {[
            ["Where is my data stored?",
              "On your own Calimero node — nothing goes to a central server."],
            ["How do I invite teammates?",
              "Create a workspace and send an invite. Teammates join via their own node."],
            ["Does it work offline?",
              "Yes. Your node stores the full board locally. Sync happens when peers reconnect."],
            ["What's a team vs a project?",
              "A team (namespace) is your workspace. Projects are boards inside it — each is a Calimero context."],
            ["Is it really open-source?",
              "Completely. The logic, frontend, and node software are all MIT-licensed on GitHub."],
          ].map(([q, a]) => (
            <div key={q as string} className={styles.faqItem}>
              <strong>{q}</strong>
              <p>{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}><Logo size={22} color="#fff" /> MeroDesign</span>
            <p className={styles.footerTagline}>
              A Figma-style design tool on the Calimero p2p network.
            </p>
          </div>
          <div className={styles.footerLinks}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="/" className={styles.footerLink}>Landing page</a>
              <a href="/login" className={styles.footerLink}>Connect to node</a>
              <a href="#features" className={styles.footerLink}>Features</a>
              <a href="#faq" className={styles.footerLink}>FAQ</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Calimero</div>
              <a href="https://calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Website</a>
              <a href="https://docs.calimero.network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Docs</a>
              <a href="https://github.com/calimero-network/core" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Core node</a>
              <a href="https://github.com/calimero-network" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>GitHub org</a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Community</div>
              <a href="https://x.com/CalimeroNetwork" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>X / Twitter</a>
              <a href="https://www.youtube.com/@CalimeroNetwork" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>YouTube</a>
              <a href="https://discord.gg/calimero" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Discord</a>
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
