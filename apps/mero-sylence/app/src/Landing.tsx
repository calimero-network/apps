import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { PRODUCT } from "./session";
import "./landing.css";

export const REPO_URL =
  "https://github.com/calimero-network/apps/tree/main/apps/mero-sylence";
export const CALIMERO_URL = "https://calimero.network";
export const CALIMERO_GITHUB = "https://github.com/calimero-network";
export const CALIMERO_DOCS = "https://docs.calimero.network";

// ── marks ───────────────────────────────────────────────────────────────────
// One-colour marks that follow `currentColor`.

export function ChromeMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 8h9.3M8.54 14 3.9 5.95M15.46 14l-4.65 8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BraveMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7.2 2.5h9.6l1.6 2 2.1-.4-.6 2.4.9 1.6-3.6 10.2L12 21.5l-5.2-3.2L3.2 8.1l.9-1.6-.6-2.4 2.1.4 1.6-2Z" />
      <path d="M9 10.5 10.6 13M15 10.5 13.4 13M10.4 16.2 12 17.4l1.6-1.2M12 14.2v3.2" />
    </svg>
  );
}

function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

function CalimeroMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="8" cy="3" r="1.8" />
      <circle cx="3.2" cy="12" r="1.8" />
      <circle cx="12.8" cy="12" r="1.8" />
      <path d="M7.1 4.6 4.1 10.4M8.9 4.6l3 5.8M5 12h6" strokeLinecap="round" />
    </svg>
  );
}

function Arrow({
  dir = "right",
  size = 16,
}: {
  dir?: "right" | "down";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: dir === "down" ? "rotate(90deg)" : undefined }}
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

// ── motion helpers ──────────────────────────────────────────────────────────

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True once the element has scrolled into view (always true without IntersectionObserver). */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined" || prefersReducedMotion(),
  );
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Reveal({
  children,
  className = "",
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li";
}) {
  const [ref, seen] = useSeen<HTMLElement>();
  const props = {
    className: `reveal ${seen ? "in" : ""} ${className}`,
    style: { transitionDelay: `${delay}ms` },
  };
  return as === "li" ? (
    <li ref={ref as React.RefObject<HTMLLIElement>} {...props}>
      {children}
    </li>
  ) : (
    <div ref={ref as React.RefObject<HTMLDivElement>} {...props}>
      {children}
    </div>
  );
}

/** In-page links: the hash is the app's router, so scroll instead of setting it. */
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}
function jump(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    scrollTo(id);
  };
}

// ── people ──────────────────────────────────────────────────────────────────

type Person = { name: string; hue: string };
const JOHN: Person = { name: "John", hue: "var(--p-blue)" };
const EVE: Person = { name: "Eve", hue: "var(--p-amber)" };
const SAM: Person = { name: "Sam", hue: "var(--p-green)" };
const YOU: Person = { name: "You", hue: "var(--p-coral)" };
const PEOPLE = [JOHN, EVE, SAM, YOU];

const hue = (p: Person) => ({ "--hue": p.hue }) as CSSProperties;

function Name({ p }: { p: Person }) {
  return (
    <span className="who" style={hue(p)}>
      {p.name}
    </span>
  );
}

// ── the hero demo ───────────────────────────────────────────────────────────

const DEMO: { p: Person; text: string }[] = [
  { p: EVE, text: "Morning everyone, let's go through the launch plan." },
  { p: JOHN, text: "The store listing is ready. We still need screenshots." },
  { p: YOU, text: "I can take the screenshots this afternoon." },
  { p: SAM, text: "Speaker names looked right on Zoom yesterday." },
  { p: EVE, text: "John, can you send the deck to design by Friday?" },
  { p: JOHN, text: "Yes, I'll send it Thursday evening." },
];
const STEP_MS = 2_000;
// steps: 0 ready · 1..N lines · N+1 cleaning up · N+2 saved (holds, then loops)
const CLEAN = DEMO.length + 1;
const SAVED = DEMO.length + 2;

function clock(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A call that plays itself, at a fixed size: tiles light up in the speaker's
 * colour, lines arrive under their names, then the second pass tidies the
 * transcript and it turns into the saved meeting. Nothing in it changes its height.
 */
function CallDemo() {
  const reduced = prefersReducedMotion();
  const [step, setStep] = useState(reduced ? SAVED : 0);

  useEffect(() => {
    if (reduced) return;
    const wait = step === SAVED ? STEP_MS * 4.5 : step === 0 ? 900 : STEP_MS;
    const t = setTimeout(() => setStep((s) => (s >= SAVED ? 0 : s + 1)), wait);
    return () => clearTimeout(t);
  }, [step, reduced]);

  const live = step >= 1 && step <= DEMO.length;
  const speaking = live ? DEMO[step - 1]!.p : null;
  const lines = DEMO.slice(0, Math.min(step, DEMO.length));
  const ended = step > DEMO.length;

  return (
    <div
      className="demo"
      role="img"
      aria-label="A call on Google Meet: Eve, John, Sam and you talk, and Sylence writes each line under the speaker's name, then saves the meeting with a timestamped transcript, a summary and action items."
    >
      <div className="demo-call">
        <div className="demo-bar">
          <span className="demo-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="demo-url">meet.google.com/launch-plan</span>
        </div>
        <div className="demo-tiles">
          {PEOPLE.map((p) => (
            <div
              key={p.name}
              className={`demo-tile ${speaking === p ? "speaking" : ""}`}
              style={hue(p)}
            >
              <span className="demo-avatar">{p.name[0]}</span>
              <span className="demo-name">{p.name}</span>
              <span className="demo-wave" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          ))}
          <div className={`demo-ended ${ended ? "in" : ""}`}>Call ended</div>
        </div>
        <div className="demo-controls" aria-hidden="true">
          <i />
          <i />
          <i className="end" />
        </div>
      </div>

      <div className="demo-panel">
        <div className="demo-panel-head">
          <img src="./favicon.svg" alt="" width={18} height={18} />
          <strong>{PRODUCT}</strong>
          <span className={`demo-state ${live ? "rec" : ""}`}>
            {step === 0 ? (
              "Ready"
            ) : live ? (
              <>
                <span className="rec-dot" /> {clock(step * 7)}
              </>
            ) : step === CLEAN ? (
              "Cleaning up…"
            ) : (
              "Saved"
            )}
          </span>
        </div>
        <div className="demo-progress" aria-hidden="true">
          <i
            className={step === CLEAN ? "run" : step === SAVED ? "full" : ""}
          />
        </div>
        <ol className="demo-lines">
          {lines.map((l, i) => (
            <li key={`${i}-${l.p.name}`} className="demo-line">
              <Name p={l.p} />
              <span className="demo-text">{l.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <SavedMeeting shown={step === SAVED} />
    </div>
  );
}

const SUMMARY =
  "Launch plan review. The store listing is ready apart from screenshots, which you take this afternoon. Speaker names checked out on Zoom. John sends the deck to design on Thursday, ahead of Friday.";
const ACTIONS: { text: string; p: Person }[] = [
  { text: "Take the screenshots", p: YOU },
  { text: "Send the deck by Friday", p: JOHN },
];

/** Where the call ends up: the saved meeting, transcript with times, summary and action items beside it. */
function SavedMeeting({ shown }: { shown: boolean }) {
  return (
    <div className={`demo-saved ${shown ? "in" : ""}`} aria-hidden={!shown}>
      <div className="saved-head">
        <img src="./favicon.svg" alt="" width={18} height={18} />
        <span className="saved-crumb">Meetings /</span>
        <strong>Launch plan</strong>
        <span className="saved-meta">Google Meet · 0:42 · 4 people</span>
        <span className="saved-badge">Revised</span>
      </div>
      <div className="saved-body">
        <ol className="saved-transcript">
          {DEMO.map((l, i) => (
            <li key={i} style={{ transitionDelay: `${150 + i * 70}ms` }}>
              <time>{clock(i * 7)}</time>
              <Name p={l.p} />
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
        <aside className="saved-side">
          <section style={{ transitionDelay: "450ms" }}>
            <h4>Summary</h4>
            <p>{SUMMARY}</p>
          </section>
          <section style={{ transitionDelay: "650ms" }}>
            <h4>
              Action items <span className="saved-count">{ACTIONS.length}</span>
            </h4>
            <ul>
              {ACTIONS.map((a) => (
                <li key={a.text}>
                  <span className="demo-check" aria-hidden="true" />
                  <span className="saved-action">{a.text}</span>
                  <Name p={a.p} />
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ── how it works: three drawn scenes ────────────────────────────────────────

function SceneInstall() {
  return (
    <div className="scene scene-install" aria-hidden="true">
      <div className="toolbar">
        <span className="omni" />
        <span className="ext" />
        <span className="ext" />
        <span className="ext sylence">
          <img src="./favicon.svg" alt="" width={16} height={16} />
        </span>
      </div>
      <div className="popup">
        <b />
        <i />
        <i className="short" />
        <span className="go">Record meeting</span>
      </div>
    </div>
  );
}

function SceneRecord() {
  return (
    <div className="scene scene-record" aria-hidden="true">
      <span className="ring" />
      <span className="ring r2" />
      <span className="rec-btn" />
      <span className="rec-label">00:42</span>
    </div>
  );
}

function SceneRead() {
  return (
    <div className="scene scene-read" aria-hidden="true">
      <div className="doc">
        <p>
          <Name p={EVE} /> <i />
        </p>
        <p>
          <Name p={JOHN} /> <i className="short" />
        </p>
        <p>
          <Name p={SAM} /> <i />
        </p>
        <p className="todo">
          <span className="demo-check done" /> <i className="short" />
        </p>
      </div>
    </div>
  );
}

const STEPS: { scene: ReactNode; title: string; body: string }[] = [
  {
    scene: <SceneInstall />,
    title: "Add it to your browser",
    body: "Install Sylence in Chrome or Brave and sign in with a passkey. No password, no bot account.",
  },
  {
    scene: <SceneRecord />,
    title: "Press record on the call",
    body: "Open Meet, Zoom or Teams in the browser and click Record. Nobody new joins the call.",
  },
  {
    scene: <SceneRead />,
    title: "Read it, tick it off",
    body: "The transcript lands in your team's workspace with who said what, and the follow-ups to do.",
  },
];

// ── what you get: drawn tiles ───────────────────────────────────────────────

const SPOKEN: [Person, string][] = [
  [EVE, "Can we ship unlisted first?"],
  [JOHN, "Yes, then public next week."],
  [SAM, "I'll ask legal tomorrow morning."],
  [YOU, "Sounds good, thanks all."],
];

function TileSpeakers() {
  return (
    <div className="mini-transcript" aria-hidden="true">
      {SPOKEN.map(([p, t], i) => (
        <p key={i}>
          <Name p={p} /> <span>{t}</span>
        </p>
      ))}
      <div className="platforms">
        <span>Google Meet</span>
        <span>Zoom</span>
        <span>Microsoft Teams</span>
      </div>
    </div>
  );
}

function TileCleanup() {
  return (
    <div className="cleanup" aria-hidden="true">
      <p className="before">uh so the the deck by uh friday</p>
      <span className="cleanup-arrow">
        <Arrow dir="down" size={14} />
      </span>
      <p className="after">So, the deck by Friday.</p>
    </div>
  );
}

function TileActions() {
  return (
    <ul className="todos" aria-hidden="true">
      <li className="done">
        <span className="demo-check done" /> Screenshots for the listing
      </li>
      <li>
        <span className="demo-check" /> Send the deck to design
      </li>
      <li>
        <span className="demo-check" /> Ask legal about the policy
      </li>
    </ul>
  );
}

function TileSearch() {
  return (
    <div className="search-demo" aria-hidden="true">
      <div className="field">
        deck
        <span className="caret" />
      </div>
      <p>
        <Name p={EVE} /> …send the <mark>deck</mark> to design by Friday?
      </p>
      <p className="dim-line">Launch plan · Tuesday</p>
    </div>
  );
}

function TileExport() {
  return (
    <div className="files" aria-hidden="true">
      <span className="file">
        <b>.md</b>
        launch-plan
      </span>
      <span className="file">
        <b>.txt</b>
        launch-plan
      </span>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

function Available() {
  return (
    <div className="available">
      <span>Available for</span>
      <span className="browser">
        <ChromeMark /> Chrome
      </span>
      <span className="browser">
        <BraveMark /> Brave
      </span>
    </div>
  );
}

function Down({
  to,
  label,
  dark = false,
}: {
  to: string;
  label: string;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      className={`lp-down ${dark ? "on-dark" : ""}`}
      onClick={() => scrollTo(to)}
      aria-label={label}
    >
      <Arrow dir="down" size={18} />
    </button>
  );
}

const SECTIONS = [
  { id: "top", label: "Sylence" },
  { id: "how", label: "How it works" },
  { id: "private", label: "Privacy" },
  { id: "features", label: "Features" },
  { id: "open", label: "Open source" },
  { id: "get", label: "Get Sylence" },
];

/** The section in the middle of the screen. */
function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

const NAV_H = 60;

/**
 * A wheel step moves one whole section. A section taller than the screen
 * scrolls normally until its edge. A trackpad's momentum keeps
 * extending the pause, so one swipe is one section.
 */
function useSectionWheel() {
  useEffect(() => {
    let lock = 0;
    const onWheel = (e: WheelEvent) => {
      if (
        e.ctrlKey ||
        Math.abs(e.deltaY) < 4 ||
        Math.abs(e.deltaY) < Math.abs(e.deltaX)
      )
        return;
      const now = performance.now();
      if (now < lock) {
        e.preventDefault();
        lock = Math.max(lock, now + 150);
        return;
      }
      const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
        (el): el is HTMLElement => el !== null,
      );
      if (els.length === 0) return;
      const tops = els.map(
        (el) => el.getBoundingClientRect().top + window.scrollY,
      );
      const view = window.scrollY + NAV_H;
      let i = 0;
      tops.forEach((t, k) => {
        if (t <= view + 8) i = k;
      });
      const bottom = tops[i]! + els[i]!.offsetHeight;
      const down = e.deltaY > 0;
      if (down && bottom > window.scrollY + window.innerHeight + 8) return;
      if (!down && tops[i]! < view - 8) return;
      const next = down ? i + 1 : i - 1;
      if (next < 0 || next >= els.length) return;
      e.preventDefault();
      lock = now + 900;
      window.scrollTo({
        top: next === 0 ? 0 : tops[next]! - NAV_H,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
}

/** Dots on the right edge, one per section; the current one is lit. */
function SectionDots() {
  const active = useActiveSection();
  useSectionWheel();
  return (
    <nav className="lp-dots" aria-label="Page sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === active ? "on" : ""}
          aria-label={s.label}
          aria-current={s.id === active ? "true" : undefined}
          onClick={() => scrollTo(s.id)}
        >
          <span className="lp-dot-label">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The landing page's top bar. `sections`: the in-page links, only on the landing itself. */
export function LandingNav({
  onSignIn,
  sections = true,
}: {
  /** Absent when signed in: the button opens the app instead. */
  onSignIn?: () => void;
  sections?: boolean;
}) {
  return (
    <header className="lp-nav">
      <div className="lp-inner lp-nav-inner">
        <a className="brand" href="#/" aria-label={`${PRODUCT} home`}>
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span className="brand-name">{PRODUCT}</span>
        </a>
        {sections ? (
          <nav className="lp-links" aria-label="sections">
            <a href="#how" onClick={jump("how")}>
              How it works
            </a>
            <a href="#private" onClick={jump("private")}>
              Privacy
            </a>
            <a href="#features" onClick={jump("features")}>
              Features
            </a>
            <a href="#open" onClick={jump("open")}>
              Open source
            </a>
          </nav>
        ) : (
          <span className="lp-links" />
        )}
        <div className="lp-nav-right">
          <a
            className="lp-icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Sylence on GitHub"
          >
            <GitHubMark size={18} />
          </a>
          {onSignIn ? (
            <button type="button" className="btn small" onClick={onSignIn}>
              Sign in
            </button>
          ) : (
            <a className="btn small" href="#/">
              Open {PRODUCT}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-inner lp-footer-inner">
        <div className="brand">
          <img src="./favicon.svg" alt="" width={20} height={20} />
          <span className="brand-name">{PRODUCT}</span>
          <a
            href={CALIMERO_URL}
            target="_blank"
            rel="noreferrer"
            className="lp-built"
          >
            <CalimeroMark size={13} /> Built on Calimero
          </a>
        </div>
        <nav aria-label="links">
          <a href="#/install">Install</a>
          <a href="#/faq">FAQ</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/terms">Terms</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source
          </a>
          <a href={CALIMERO_URL} target="_blank" rel="noreferrer">
            calimero.network
          </a>
          <a href={CALIMERO_GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={CALIMERO_DOCS} target="_blank" rel="noreferrer">
            Docs
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** A signed-out page other than the landing (the install page), in the landing's frame. */
export function LandingPage({
  onSignIn,
  children,
}: {
  onSignIn?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="landing lp-page">
      <LandingNav onSignIn={onSignIn} sections={false} />
      <main className="lp-page-main">{children}</main>
      <LandingFooter />
    </div>
  );
}

/** The front door when signed out. */
export function Landing({
  onSignIn,
  onInstall,
}: {
  onSignIn: () => void;
  onInstall?: () => void;
}) {
  // The fleet's node badge floats on every page; a visitor has no node to judge yet.
  useEffect(() => {
    document.body.classList.add("on-landing");
    // One section per screen: the page snaps from section to section.
    document.documentElement.classList.add("lp-snap");
    return () => {
      document.body.classList.remove("on-landing");
      document.documentElement.classList.remove("lp-snap");
    };
  }, []);
  return (
    <div className="landing">
      <LandingNav onSignIn={onSignIn} />

      <section id="top" className="lp-hero lp-sect">
        <div className="lp-inner">
          <div className="lp-stage">
            <CallDemo />
          </div>
          <div className="lp-hero-copy">
            <h1>Meeting notes that write themselves, privately.</h1>
            <p>
              Record Meet, Zoom and Teams from your browser. Speech becomes text
              on your laptop, so the audio never leaves it.
            </p>
            <div className="lp-cta">
              {onInstall && (
                <button
                  type="button"
                  className="btn primary large"
                  onClick={onInstall}
                >
                  Get the extension
                </button>
              )}
              {/* New visitors start here; "Sign in" stays in the top bar. Both open the
                  passkey panel, which signs in or makes the account. */}
              <button
                type="button"
                className={onInstall ? "btn large" : "btn primary large"}
                onClick={onSignIn}
              >
                Create an account
              </button>
            </div>
            <Available />
          </div>
          <Down to="how" label="See how it works" />
        </div>
      </section>

      <section id="how" className="lp-sect lp-band dark">
        <div className="lp-inner">
          <Reveal className="lp-head">
            <span className="lp-eyebrow">How it works</span>
            <h2 className="lp-h2">From call to notes in three clicks.</h2>
          </Reveal>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} as="li" className="lp-step" delay={i * 140}>
                {s.scene}
                <span className="lp-step-n">{i + 1}</span>
                <h3 className="lp-h3">{s.title}</h3>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </ol>
          <Down to="private" label="Next: privacy" dark />
        </div>
      </section>

      <section id="private" className="lp-sect lp-band">
        <div className="lp-inner lp-split">
          <Reveal>
            <span className="lp-eyebrow">Private by design</span>
            <h2 className="lp-h2">The audio stays on your laptop.</h2>
            <p className="lp-p">
              Recording, speech to text and naming all happen inside your
              browser. Only the finished text goes to your workspace, which
              lives on a Calimero node only your organization reaches. Nobody in
              between reads it, us included.
            </p>
            <ul className="lp-ticks">
              <li>No bot in the call, nothing to admit</li>
              <li>Audio is never uploaded or stored</li>
              <li>Passkey sign-in, no passwords</li>
            </ul>
          </Reveal>
          <Reveal delay={150}>
            <div
              className="flow"
              role="img"
              aria-label="The call's audio goes into your browser; only text goes on to your node."
            >
              <div className="station">
                <span className="station-art bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <strong>The call</strong>
                <span>audio</span>
              </div>
              <div className="pipe audio" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="station hot">
                <span className="station-art" aria-hidden="true">
                  <img src="./favicon.svg" alt="" width={26} height={26} />
                </span>
                <strong>Your browser</strong>
                <span>speech → text</span>
              </div>
              <div className="pipe text" aria-hidden="true">
                <i>Aa</i>
                <i>Aa</i>
              </div>
              <div className="station">
                <span className="station-art" aria-hidden="true">
                  <CalimeroMark size={22} />
                </span>
                <strong>Your node</strong>
                <span>text only</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="features" className="lp-sect lp-band soft">
        <div className="lp-inner">
          <Reveal className="lp-head">
            <span className="lp-eyebrow">What you get</span>
            <h2 className="lp-h2">Notes your team will actually read.</h2>
          </Reveal>
          <div className="bento">
            <Reveal className="tile wide">
              <TileSpeakers />
              <h3 className="lp-h3">Knows who said what</h3>
              <p>
                Names come from the call itself: the tiles, the captions,
                whoever is lit up.
              </p>
            </Reveal>
            <Reveal className="tile" delay={100}>
              <TileCleanup />
              <h3 className="lp-h3">Cleaned up after the call</h3>
              <p>
                A second, slower pass rewrites the transcript once everyone
                hangs up.
              </p>
            </Reveal>
            <Reveal className="tile">
              <TileActions />
              <h3 className="lp-h3">Action items</h3>
              <p>Pulled from what was said, then ticked off by the team.</p>
            </Reveal>
            <Reveal className="tile" delay={100}>
              <TileSearch />
              <h3 className="lp-h3">Search every meeting</h3>
              <p>Find the moment someone said it, across every call.</p>
            </Reveal>
            <Reveal className="tile" delay={200}>
              <TileExport />
              <h3 className="lp-h3">Take it anywhere</h3>
              <p>Download a meeting as Markdown or text.</p>
            </Reveal>
            <Reveal className="tile full ink">
              <div className="stat">
                <span className="stat-n">0</span>
                <span className="stat-unit">bytes of audio uploaded</span>
              </div>
              <p>
                Whisper runs on your laptop&apos;s GPU through WebGPU, with a
                smaller model for machines without one.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="open" className="lp-sect lp-band dark">
        <div className="lp-inner lp-split">
          <Reveal>
            <span className="lp-eyebrow">Built on Calimero</span>
            <h2 className="lp-h2">Open source, on infrastructure you own.</h2>
            <p className="lp-p">
              The extension, the page and the workspace logic are open on
              GitHub. {PRODUCT} runs on Calimero, a framework for private,
              peer-to-peer apps where your data lives on nodes you control.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <ul className="lp-rows">
              <li>
                <a href={REPO_URL} target="_blank" rel="noreferrer">
                  <GitHubMark size={20} />
                  <span>
                    <strong>Sylence source</strong>
                    <em>calimero-network/apps</em>
                  </span>
                  <Arrow />
                </a>
              </li>
              <li>
                <a href={CALIMERO_URL} target="_blank" rel="noreferrer">
                  <CalimeroMark size={20} />
                  <span>
                    <strong>Calimero</strong>
                    <em>calimero.network</em>
                  </span>
                  <Arrow />
                </a>
              </li>
              <li>
                <a href={CALIMERO_GITHUB} target="_blank" rel="noreferrer">
                  <GitHubMark size={20} />
                  <span>
                    <strong>Calimero on GitHub</strong>
                    <em>github.com/calimero-network</em>
                  </span>
                  <Arrow />
                </a>
              </li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section id="get" className="lp-sect lp-last">
        <div className="lp-band coral lp-final-band">
          <div className="lp-inner lp-final">
            <h2 className="lp-h2">Record your next call with {PRODUCT}.</h2>
            <div className="lp-cta">
              {onInstall && (
                <button
                  type="button"
                  className="btn large lp-btn-ink"
                  onClick={onInstall}
                >
                  Get the extension
                </button>
              )}
              <button
                type="button"
                className="btn large lp-btn-line"
                onClick={onSignIn}
              >
                Create an account
              </button>
            </div>
            <Available />
          </div>
        </div>

        <LandingFooter />
      </section>

      <SectionDots />
    </div>
  );
}
