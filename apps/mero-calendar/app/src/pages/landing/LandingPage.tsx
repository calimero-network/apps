import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import styles from "./landing.module.scss";

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add(styles.visible);
          obs.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

// Small month-grid preview mock with a few colored event chips, replacing
// mero-pixart's image-editor preview.
function CalendarPreview() {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // 35-cell month grid; a couple of cells carry event chips.
  const events: Record<number, { label: string; color: string; lock?: boolean }[]> = {
    9: [{ label: "Standup", color: "#6c8cff" }],
    11: [{ label: "Design sync", color: "#43d17a" }],
    16: [
      { label: "1:1", color: "#ff9f43", lock: true },
      { label: "Review", color: "#a55eea" },
    ],
    18: [{ label: "Launch", color: "#ff5d6c" }],
    23: [{ label: "Retro", color: "#26c6da" }],
  };

  return (
    <div className={styles.previewShell}>
      <div className={styles.previewToolbar}>
        <span className={styles.previewDot} style={{ background: "#ff5f56" }} />
        <span className={styles.previewDot} style={{ background: "#ffbd2e" }} />
        <span className={styles.previewDot} style={{ background: "#27c93f" }} />
        <span className={styles.previewToolbarLogo}>
          <CalendarLogo size={14} color="var(--accent)" /> Mero Calendar
        </span>
        <span className={styles.previewMonth}>June 2026</span>
      </div>
      <div className={styles.previewWeekRow}>
        {weekdays.map((d) => (
          <span key={d} className={styles.previewWeekday}>
            {d}
          </span>
        ))}
      </div>
      <div className={styles.previewGrid}>
        {Array.from({ length: 35 }).map((_, i) => {
          const day = i - 1; // offset so the 1st lands mid-first-row
          const chips = events[i] ?? [];
          return (
            <div
              key={i}
              className={`${styles.previewCell} ${day === 16 ? styles.previewToday : ""}`}
            >
              {day > 0 && day <= 30 && (
                <span className={styles.previewDayNum}>{day}</span>
              )}
              {chips.map((c) => (
                <span
                  key={c.label}
                  className={styles.previewChip}
                  style={{ background: c.color }}
                >
                  {c.lock && <span className={styles.previewLock}>🔒</span>}
                  {c.label}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();
  const [menuOpen, setMenuOpen] = useState(false);
  const featuresRef = useReveal();
  const previewRef = useReveal();
  const howRef = useReveal();
  const faqRef = useReveal();

  function openApp() {
    navigate(isAuthenticated ? "/teams" : "/login");
  }
  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className={styles.root}>
      <section className={styles.heroSection}>
        <header className={styles.header}>
          <span className={styles.logo}>
            <CalendarLogo size={26} color="var(--accent)" /> Mero Calendar
          </span>
          <nav className={styles.headerNav}>
            <a href="#features" className={styles.navLink}>
              Features
            </a>
            <a href="#faq" className={styles.navLink}>
              FAQ
            </a>
            <a
              href="https://github.com/calimero-network"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.navLink}
            >
              GitHub
            </a>
          </nav>
          <div className={styles.headerActions}>
            <ThemeToggle />
            <button
              className={styles.connectBtn}
              onClick={openApp}
              data-testid="landing-cta"
            >
              Open calendar
            </button>
          </div>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
          {menuOpen && (
            <div className={styles.mobileMenu}>
              <a href="#features" className={styles.mobileMenuItem} onClick={closeMenu}>
                Features
              </a>
              <a href="#faq" className={styles.mobileMenuItem} onClick={closeMenu}>
                FAQ
              </a>
              <button
                className={styles.mobileMenuCta}
                onClick={() => {
                  openApp();
                  closeMenu();
                }}
              >
                Open calendar
              </button>
            </div>
          )}
        </header>

        <div className={styles.bgCircle1} />
        <div className={styles.bgCircle2} />
        <div className={styles.bgCircle3} />

        <main className={styles.hero}>
          <div className={styles.heroBadge}>Open-source · P2P · Self-hosted</div>
          <h1 className={styles.headline}>
            Shared team calendars.
            <br />
            <span className={styles.headlineAccent}>Your schedule, your nodes.</span>
          </h1>
          <p className={styles.sub}>
            Mero Calendar is a real-time, collaborative calendar built on the
            Calimero p2p network. Plan together with shared team events, keep your
            own private events node-local, and sync directly between peers — no
            central server.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.ctaPrimary} onClick={openApp}>
              {isAuthenticated ? "Open calendar →" : "Get started →"}
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

      <section className={styles.previewSection}>
        <div className={styles.previewLabel}>See it in action</div>
        <div ref={previewRef} className={`${styles.previewWrap} ${styles.reveal}`}>
          <CalendarPreview />
        </div>
      </section>

      <section id="features" className={styles.featuresSection}>
        <div ref={featuresRef} className={`${styles.featuresInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>Everything a team calendar needs</h2>
          <p className={styles.sectionSub}>
            Built for teams who care about who owns their schedule.
          </p>
          <div className={styles.featuresGrid}>
            {[
              {
                icon: "👥",
                title: "Shared team calendars",
                body: "Create a team and everyone sees the same calendar. Invite peers to events by name.",
              },
              {
                icon: "🔒",
                title: "Private events",
                body: "Keep personal events node-local — they never sync to the rest of the team.",
              },
              {
                icon: "⇄",
                title: "P2P real-time sync",
                body: "Events propagate instantly across peers over the Calimero network. No central relay.",
              },
              {
                icon: "🗓️",
                title: "Week · month · year",
                body: "Switch between week, month and year views. Drag-free event creation from any day.",
              },
              {
                icon: "🔑",
                title: "Self-sovereign",
                body: "Your node, your keys, your calendar data. Zero telemetry, zero central storage.",
              },
              {
                icon: "🌗",
                title: "Light & dark",
                body: "A calm, accessible palette that reads well in both light and dark mode.",
              },
            ].map(({ icon, title, body }, i) => (
              <div
                key={title}
                className={styles.featureCard}
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div className={styles.featureIcon}>{icon}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.howSection}>
        <div ref={howRef} className={`${styles.howInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <div className={styles.howSteps}>
            {[
              {
                n: "01",
                title: "Run your node",
                body: "Start a local Calimero node. Takes under a minute.",
              },
              {
                n: "02",
                title: "Connect the app",
                body: "Open Mero Calendar and connect your node. No account, no email.",
              },
              {
                n: "03",
                title: "Create a team",
                body: "Spin up a team — it gets one shared calendar everyone can edit.",
              },
              {
                n: "04",
                title: "Invite your team",
                body: "Share an invite. Teammates join from their own nodes. Events sync P2P.",
              },
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

      <section id="faq" className={styles.faqSection}>
        <div ref={faqRef} className={`${styles.faqInner} ${styles.reveal}`}>
          <h2 className={styles.sectionTitle}>FAQ</h2>
          {[
            [
              "Where are my events stored?",
              "On your own Calimero node — shared events sync to your team's peers, private events never leave your node.",
            ],
            [
              "How do I invite collaborators?",
              "Create a team and share an invite code. Collaborators join via their own node.",
            ],
            [
              "What's the difference between shared and private events?",
              "Shared events live in the team calendar and sync to everyone. Private events are node-local and visible only to you.",
            ],
            [
              "Does it work offline?",
              "Yes. Your node holds the full calendar locally. Edits sync when peers reconnect.",
            ],
            [
              "Is it really open-source?",
              "Completely. The app, the contract, and the node software are all MIT-licensed on GitHub.",
            ],
          ].map(([q, a]) => (
            <div key={q} className={styles.faqItem}>
              <strong>{q}</strong>
              <p>{a}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}>
              <CalendarLogo size={22} color="var(--accent)" /> Mero Calendar
            </span>
            <p className={styles.footerTagline}>
              A collaborative, p2p team calendar on the Calimero network.
            </p>
          </div>
          <div className={styles.footerLinks}>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Product</div>
              <a href="/" className={styles.footerLink}>
                Landing page
              </a>
              <a href="/login" className={styles.footerLink}>
                Open calendar
              </a>
              <a href="#features" className={styles.footerLink}>
                Features
              </a>
              <a href="#faq" className={styles.footerLink}>
                FAQ
              </a>
            </div>
            <div className={styles.footerCol}>
              <div className={styles.footerColTitle}>Calimero</div>
              <a
                href="https://calimero.network"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                Website
              </a>
              <a
                href="https://docs.calimero.network"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                Docs
              </a>
              <a
                href="https://github.com/calimero-network"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                GitHub org
              </a>
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
