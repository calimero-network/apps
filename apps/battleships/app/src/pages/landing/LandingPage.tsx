/**
 * Battleships' front door, in the fleet's shape.
 *
 * `/` was `Authenticate`: a hero, a six-item feature grid, a ConnectButton and
 * three outbound links. Not empty — but a single screen, where mero-pixart /
 * mero-design / mero-stream all give a visitor the game's own UI, how it works
 * and an FAQ before asking them to connect a node.
 *
 * `Authenticate` stays on `/login`, because it owns the ConnectButton and the
 * `returnTo` handling that sends a deep-linked invite back where it came from.
 *
 * ⚠️ This page redirects an authenticated visitor to `/lobby`. That is the
 * desktop auth-skip: the launcher opens this app at `/`, which used to be the
 * connect screen, so without the redirect a window handed a live session would
 * sit on the marketing page — the skip would look broken while working.
 */
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import translations from "../../constants/en.global.json";
import styles from "./LandingPage.module.css";

const REPO = "https://github.com/calimero-network/apps/tree/main/apps/battleships";

/** A still of a match in progress — the thing you cannot see before connecting. */
function BoardPreview() {
  // A fixed 8x8 sample. `hit` and `miss` are placed by hand rather than
  // generated, so the shot pattern is stable across renders and screenshots.
  const hits = new Set(["2,3", "3,3", "4,3", "5,6"]);
  const misses = new Set(["0,0", "1,5", "6,2", "7,7", "4,0", "2,7"]);
  const ships = new Set(["1,1", "1,2", "6,5", "6,6", "6,7"]);

  return (
    <div className={styles.preview}>
      <div className={styles.previewTop}>
        <span className={styles.previewBrand}>
          Battle<span>ships</span>
        </span>
        <span className={styles.previewTabActive}>Your turn</span>
        <span className={styles.previewConnected}>● 2 players · synced</span>
      </div>
      <div className={styles.boardWrap}>
        <div className={styles.boardLabel}>Enemy waters</div>
        <div className={styles.board} role="img" aria-label="A battleships grid mid-match: four hits, six misses.">
          {Array.from({ length: 8 }, (_, r) =>
            Array.from({ length: 8 }, (_, c) => {
              const k = `${r},${c}`;
              const cls = hits.has(k)
                ? styles.cellHit
                : misses.has(k)
                  ? styles.cellMiss
                  : styles.cell;
              return <span key={k} className={cls} />;
            }),
          )}
        </div>
        <div className={styles.boardLabel}>Your fleet</div>
        <div className={styles.board} role="img" aria-label="Your own grid, with your fleet placed.">
          {Array.from({ length: 8 }, (_, r) =>
            Array.from({ length: 8 }, (_, c) => {
              const k = `${r},${c}`;
              return (
                <span key={k} className={ships.has(k) ? styles.cellShip : styles.cell} />
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

const STEPS: [string, string, string][] = [
  ["01", "Run your node", "Start a Calimero node. It holds your board and never shares the placements."],
  ["02", "Connect", "Pick it from the list. No account, no email."],
  ["03", "Open a lobby", "Create one and send the invite, or paste an invite you were sent."],
  ["04", "Place and fire", "Both fleets are placed privately. Shots resolve through the contract."],
];

const FAQ: [string, string][] = [
  ["Can my opponent see my ships?", "No. Placements live in your own context and are never sent; the contract only ever answers whether a shot hit."],
  ["What stops someone lying about a hit?", "The shot is resolved by the contract, not by either client. A cross-context call reads the target's board and returns the result."],
  ["Is there a server?", "No. Both nodes hold the match and sync it peer to peer."],
  ["What is a lobby, technically?", "A namespace. Each match inside it is its own context with a two-player subgroup, so one match cannot read another."],
  ["Do we need to be online at once?", "To play a turn, yes — but the state is durable, so a match survives either side disconnecting."],
];

export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useMero();
  const [menuOpen, setMenuOpen] = useState(false);

  // The desktop auth-skip. Honours a `returnTo` the auth guard stashed, so a
  // deep-linked invite still lands on the lobby it named.
  useEffect(() => {
    if (!isAuthenticated) return;
    const returnTo =
      (location.state as { returnTo?: string } | null)?.returnTo || "/lobby";
    navigate(returnTo, { replace: true });
  }, [isAuthenticated, navigate, location.state]);

  const enter = () => navigate(isAuthenticated ? "/lobby" : "/login");

  return (
    <div className={styles.root}>
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}>
            Battle<span>ships</span>
          </span>
          <nav className={styles.nav}>
            <a href="#features" className={styles.navLink}>Features</a>
            <a href="#how" className={styles.navLink}>How it works</a>
            <a href="#faq" className={styles.navLink}>FAQ</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={styles.navLink}>GitHub</a>
          </nav>
          <button className={styles.headerCta} onClick={enter}>
            {isAuthenticated ? "Open lobby" : "Connect a node"}
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
                {isAuthenticated ? "Open lobby" : "Connect a node"}
              </button>
            </div>
          )}
        </header>

        <div className={styles.glow1} aria-hidden="true" />
        <div className={styles.glow2} aria-hidden="true" />

        <main className={styles.hero}>
          <div className={styles.badge}>Open source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Your fleet stays on
            <br />
            <span className={styles.headlineAccent}>your own node.</span>
          </h1>
          <p className={styles.sub}>{translations.home.demoDescription}</p>
          <div className={styles.heroActions}>
            <button className={styles.ctaPrimary} onClick={enter}>
              {isAuthenticated ? "Open lobby →" : "Get started →"}
            </button>
            <a className={styles.ctaSecondary} href={REPO} target="_blank" rel="noopener noreferrer">
              View on GitHub →
            </a>
          </div>
        </main>
      </section>

      <section className={styles.previewSection}>
        <div className={styles.eyebrow}>A match in progress</div>
        <div className={styles.previewWrap}>
          <BoardPreview />
        </div>
      </section>

      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <h2 className={styles.sectionTitle}>What makes it different</h2>
          <p className={styles.sectionSub}>
            A board game where neither player has to trust the other, or a server.
          </p>
          <div className={styles.grid}>
            {/* The feature copy already lived in en.global.json; the icons pair
                with it here rather than duplicating the strings. */}
            {translations.auth.description.features.map((feature, i) => (
              <div key={feature} className={styles.card}>
                <div className={styles.cardIcon} aria-hidden="true">
                  {["⚓", "◎", "⇄", "✉", "◫", "▣"][i] ?? "◈"}
                </div>
                <p>{feature}</p>
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
              Battle<span>ships</span>
            </span>
            <p className={styles.footerTagline}>
              A decentralized battleships game on the Calimero p2p network.
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
