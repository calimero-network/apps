import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero, ConnectButton } from "@calimero-network/mero-react";
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
  const layers = [
    { name: "Sky gradient", kind: "▦" },
    { name: "Mountains",    kind: "◭" },
    { name: "Portrait",     kind: "◑", active: true },
    { name: "Curves adj.",  kind: "◐" },
    { name: "Grain",        kind: "▩" },
  ];

  const adjRows: [string, string][] = [
    ["Exposure",   "+12"],
    ["Contrast",   "+8"],
    ["Saturation", "−4"],
    ["Hue",        "+2°"],
    ["Blur",       "0 px"],
  ];

  return (
    <div key={animKey} className={styles.previewShell}>
      {/* Top bar */}
      <div className={styles.previewToolbar}>
        <div className={styles.previewDot} style={{ background: "#ff5f56" }} />
        <div className={styles.previewDot} style={{ background: "#ffbd2e" }} />
        <div className={styles.previewDot} style={{ background: "#27c93f" }} />
        <span className={styles.previewToolbarLogo}><Logo size={14} color="#fff" /> MeroPixArt</span>
        {["✛", "▭", "✎", "⬚", "⟲"].map((t, i) => (
          <div key={i} className={styles.previewTool}>{t}</div>
        ))}
      </div>

      <div className={styles.previewBody}>
        {/* Tool rail */}
        <div className={styles.previewRail}>
          {["✛", "▭", "❍", "✎", "▤", "T", "⬡"].map((t, i) => (
            <div
              key={i}
              className={`${styles.railTool} ${i === 3 ? styles.railActive : ""}`}
              style={{ animationDelay: `${0.2 + i * 0.06}s` }}
            >{t}</div>
          ))}
        </div>

        {/* Canvas */}
        <div className={`${styles.previewCanvas} mp-checkerboard`}>
          <div className={styles.canvasImage} />
          <div className={styles.canvasSelection} />
          <div className={styles.canvasCursor} />
        </div>

        {/* Layers + adjustments */}
        <div className={styles.previewPanel}>
          <div className={styles.panelTitle}>Layers</div>
          {layers.map((l, i) => (
            <div
              key={l.name}
              className={`${styles.layerRow} ${l.active ? styles.layerActive : ""}`}
              style={{ animationDelay: `${0.4 + i * 0.1}s` }}
            >
              <span className={styles.layerThumb}>{l.kind}</span>
              <span className={styles.layerName}>{l.name}</span>
              <span className={styles.layerEye}>◉</span>
            </div>
          ))}
          <div className={styles.panelSep} />
          <div className={styles.panelTitle}>Adjustments</div>
          {adjRows.map(([label, val], i) => (
            <div key={label} className={styles.adjRow} style={{ animationDelay: `${0.9 + i * 0.08}s` }}>
              <span className={styles.adjLabel}>{label}</span>
              <span className={styles.adjTrack}><span className={styles.adjFill} style={{ width: `${40 + i * 9}%` }} /></span>
              <span className={styles.adjVal}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();
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

  // Once the node is connected, the CTA jumps straight into the workspace.
  function openEditor() {
    navigate(isAuthenticated ? "/teams" : "/login");
  }
  function closeMenu() { setMenuOpen(false); }

  return (
    <div className={styles.root}>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}><Logo size={26} /> MeroPixArt</span>
          <nav className={styles.headerNav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href="https://github.com/calimero-network" target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.connectBtn} onClick={openEditor}>
            Open editor
          </button>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
          {menuOpen && (
            <div className={styles.mobileMenu}>
              <a href="#features" className={styles.mobileMenuItem} onClick={closeMenu}>Features</a>
              <a href="#faq" className={styles.mobileMenuItem} onClick={closeMenu}>FAQ</a>
              <a href="https://github.com/calimero-network" target="_blank" rel="noopener noreferrer" className={styles.mobileMenuItem} onClick={closeMenu}>GitHub</a>
              <button className={styles.mobileMenuCta} onClick={() => { openEditor(); closeMenu(); }}>
                Open editor
              </button>
            </div>
          )}
        </header>

        {/* Animated blurred background glows */}
        <div className={styles.bgCircle1} />
        <div className={styles.bgCircle2} />
        <div className={styles.bgCircle3} />

        <main className={styles.hero}>
          <div className={styles.heroBadge}>Open-source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Collaborative image editing.<br />
            <span className={styles.headlineAccent}>Your pixels, your nodes.</span>
          </h1>
          <p className={styles.sub}>
            MeroPixArt is a real-time, layered image editor built on the Calimero
            p2p network. Paint, mask, and adjust together — every layer lives on
            your own infrastructure, shared only with the people you invite.
          </p>
          <div className={styles.heroActions}>
            <div className={styles.ctaConnect}>
              <ConnectButton label="Open editor" />
            </div>
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
        <div ref={previewRef} className={`${styles.previewWrap} ${styles.reveal}`}>
          <AppPreview animKey={animKey} />
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section id="features" className={styles.featuresSection}>
        <div ref={featuresRef} className={`${styles.featuresInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>Everything a serious editor needs</h2>
          <p className={styles.sectionSub}>Built for teams who care about who owns their pixels.</p>
          <div className={styles.featuresGrid}>
            {[
              { icon: "▦", title: "Layers & masks",      body: "Non-destructive layer stack with blend modes, opacity, and per-layer masks." },
              { icon: "⇄", title: "P2P real-time sync",  body: "Brush strokes and edits propagate instantly across peers. No central relay." },
              { icon: "◐", title: "Live adjustments",    body: "Exposure, curves, hue, blur and more — applied non-destructively in real time." },
              { icon: "✎", title: "Full paint toolkit",  body: "Brush, eraser, bucket, clone, gradient, text and shape tools out of the box." },
              { icon: "⚿", title: "Self-sovereign",      body: "Your node, your keys, your image data. Zero telemetry, zero central storage." },
              { icon: "↗", title: "Export anywhere",     body: "Flatten and export your composition as PNG whenever you need it." },
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
        <div ref={howRef} className={`${styles.howInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <div className={styles.howSteps}>
            {[
              { n: "01", title: "Run your node",     body: "Start a local Calimero node with `make dev`. Takes under a minute." },
              { n: "02", title: "Connect the app",   body: "Open MeroPixArt and connect your node. No account, no email." },
              { n: "03", title: "Create a project",  body: "Spin up an image document inside your team — pick a canvas size and start editing." },
              { n: "04", title: "Invite your team",  body: "Share an invite. Teammates join from their own nodes. Pixels sync P2P." },
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
        <div ref={faqRef} className={`${styles.faqInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>FAQ</h2>
          {[
            ["Where are my images stored?",
              "On your own Calimero node — image blobs and layers never touch a central server."],
            ["How do I invite collaborators?",
              "Create a team and share an invite code. Collaborators join via their own node."],
            ["Does it work offline?",
              "Yes. Your node holds the full document locally. Edits sync when peers reconnect."],
            ["What's a team vs a project?",
              "A team (namespace) is your workspace. Projects are image documents inside it — each is a Calimero context."],
            ["Is it really open-source?",
              "Completely. The editor, the contract, and the node software are all MIT-licensed on GitHub."],
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
            <span className={styles.footerLogo}><Logo size={22} color="#fff" /> MeroPixArt</span>
            <p className={styles.footerTagline}>
              A collaborative, layered image editor on the Calimero p2p network.
            </p>
          </div>
          <div className={styles.footerLinks}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="/" className={styles.footerLink}>Landing page</a>
              <a href="/login" className={styles.footerLink}>Open editor</a>
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
