import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckSquare } from "@calimero-network/mero-icons";

import { PRODUCT } from "./session";
import { Icon } from "./ui";

export const REPO_URL = "https://github.com/calimero-network/apps/tree/main/apps/mero-sylence";
export const CALIMERO_URL = "https://calimero.network";
export const CALIMERO_GITHUB = "https://github.com/calimero-network";
export const CALIMERO_DOCS = "https://docs.calimero.network";

// ── marks ───────────────────────────────────────────────────────────────────
// One-colour marks that follow `currentColor`, so they sit in the grayscale
// palette in both themes.

export function ChromeMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8h9.3M8.54 14 3.9 5.95M15.46 14l-4.65 8" strokeLinecap="round" />
    </svg>
  );
}

export function BraveMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {/* the lion's head: a crowned shield */}
      <path d="M7.2 2.5h9.6l1.6 2 2.1-.4-.6 2.4.9 1.6-3.6 10.2L12 21.5l-5.2-3.2L3.2 8.1l.9-1.6-.6-2.4 2.1.4 1.6-2Z" />
      <path d="M9 10.5 10.6 13M15 10.5 13.4 13M10.4 16.2 12 17.4l1.6-1.2M12 14.2v3.2" />
    </svg>
  );
}

function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

function CalimeroMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {/* three nodes, linked: a peer-to-peer network */}
      <circle cx="8" cy="3" r="1.8" />
      <circle cx="3.2" cy="12" r="1.8" />
      <circle cx="12.8" cy="12" r="1.8" />
      <path d="M7.1 4.6 4.1 10.4M8.9 4.6l3 5.8M5 12h6" strokeLinecap="round" />
    </svg>
  );
}

// ── motion helpers ──────────────────────────────────────────────────────────

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades a block in the first time it scrolls into view. */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || prefersReducedMotion());
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div ref={ref} className={`reveal ${shown ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// ── the live demo ───────────────────────────────────────────────────────────

const DEMO: { who: string; text: string }[] = [
  { who: "Ana Horvat", text: "Morning everyone, let's go through the launch plan." },
  { who: "Marko Petrovic", text: "The store listing is ready, we still need screenshots." },
  { who: "You", text: "I can take the screenshots this afternoon." },
  { who: "Ana Horvat", text: "Marko, can you send the deck to design by Friday?" },
  { who: "Marko Petrovic", text: "Yes, I'll send it Thursday evening." },
];
const SPEAKERS = ["Ana Horvat", "Marko Petrovic", "Sandi Fatic", "You"];
const STEP_MS = 1_900;

function initialsOf(name: string) {
  return name === "You" ? "Y" : name.split(" ").map((p) => p[0]).join("").slice(0, 2);
}

/**
 * A call that plays itself: tiles light up as people speak, lines arrive in
 * the transcript under their names, and the action item lands at the end.
 */
function CallDemo() {
  const reduced = prefersReducedMotion();
  const [step, setStep] = useState(reduced ? DEMO.length + 1 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setStep((s) => (s >= DEMO.length + 2 ? 0 : s + 1)), step >= DEMO.length + 1 ? STEP_MS * 2.2 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, reduced]);

  const speaking = step >= 1 && step <= DEMO.length ? DEMO[step - 1]!.who : null;
  const lines = DEMO.slice(0, Math.min(step, DEMO.length));
  const done = step > DEMO.length;

  return (
    <div className="demo" aria-label="A recorded call, transcribed as it happens" role="img">
      <div className="demo-call">
        <div className="demo-bar">
          <span className="demo-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="demo-url">meet.google.com/abc-defg-hij</span>
          <span className={`demo-rec ${done ? "off" : ""}`}>
            <span className="rec-dot" /> {done ? "Saved" : "Recording"}
          </span>
        </div>
        <div className="demo-tiles">
          {SPEAKERS.map((name) => (
            <div key={name} className={`demo-tile ${speaking === name ? "speaking" : ""}`}>
              <span className="demo-avatar">{initialsOf(name)}</span>
              <span className="demo-name">{name}</span>
              {speaking === name && (
                <span className="demo-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="demo-panel">
        <div className="demo-panel-head">
          <img src="./favicon.svg" alt="" width={18} height={18} />
          <strong>{PRODUCT}</strong>
          <span className="demo-chip">on this laptop</span>
        </div>
        <ol className="demo-lines">
          {lines.map((l, i) => (
            <li key={`${i}-${l.who}`} className="demo-line">
              <span className="demo-who">{l.who}</span>
              <span className="demo-text">{l.text}</span>
            </li>
          ))}
          {!done && step > 0 && (
            <li className="demo-line typing" aria-hidden="true">
              <span className="demo-typing">
                <i />
                <i />
                <i />
              </span>
            </li>
          )}
        </ol>
        <div className={`demo-action ${done ? "in" : ""}`}>
          <CheckSquare size={14} aria-hidden="true" />
          <span>
            Send the deck to design by Friday <em>· Marko Petrovic</em>
          </span>
        </div>
      </div>
    </div>
  );
}

/** In-page links: the hash is the app's router, so scroll instead of setting it. */
function jump(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };
}

// ── page ────────────────────────────────────────────────────────────────────

function Available() {
  return (
    <div className="available">
      <span className="dim">Available for</span>
      <span className="browser">
        <ChromeMark /> Chrome
      </span>
      <span className="browser">
        <BraveMark /> Brave
      </span>
    </div>
  );
}

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Icon name="puzzle" size={20} />,
    title: "Add the extension",
    body: "Install Sylence in Chrome or Brave and sign in with a passkey. No password, no bot account.",
  },
  {
    icon: <Icon name="mic" size={20} />,
    title: "Press record on your call",
    body: "Open Meet, Zoom or Teams in the browser and click Record. Nobody new joins the call.",
  },
  {
    icon: <Icon name="list" size={20} />,
    title: "Read it, tick it off",
    body: "The transcript lands in your team's workspace with who said what, and the action items to follow up.",
  },
];

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <Icon name="mic" />, title: "Speech to text on your laptop", body: "Whisper runs in the browser on your GPU. The audio is never uploaded." },
  { icon: <Icon name="hand" />, title: "Knows who is speaking", body: "Names come from the call's own tiles and captions, on Meet, Zoom and Teams." },
  { icon: <Icon name="wave" />, title: "Cleaned up after the call", body: "A second, more careful pass rewrites the transcript once the call ends." },
  { icon: <Icon name="check" />, title: "Action items", body: "Found in what was said, or picked from any line, and ticked off by the team." },
  { icon: <Icon name="search" />, title: "Search every meeting", body: "Find the moment someone said it, across every call in the workspace." },
  { icon: <Icon name="form" />, title: "Export anywhere", body: "Download a meeting as Markdown or text and paste it where your team works." },
];

const PLATFORMS = ["Google Meet", "Zoom", "Microsoft Teams"];

/** The front door when signed out. */
export function Landing({ onSignIn, onInstall, nodeShield }: { onSignIn: () => void; onInstall?: () => void; nodeShield?: ReactNode }) {
  return (
    <div className="landing">
      <header className="lp-nav">
        <a className="brand" href="#/" aria-label={`${PRODUCT} home`}>
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span className="brand-name">{PRODUCT}</span>
        </a>
        <nav className="lp-links" aria-label="sections">
          <a href="#how" onClick={jump("how")}>How it works</a>
          <a href="#private" onClick={jump("private")}>Privacy</a>
          <a href="#open" onClick={jump("open")}>Open source</a>
        </nav>
        <div className="topbar-right">
          {nodeShield}
          <a className="btn ghost small lp-gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Sylence on GitHub">
            <GitHubMark /> <span>GitHub</span>
          </a>
          <button type="button" className="btn small" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <a className="lp-pill" href={CALIMERO_URL} target="_blank" rel="noreferrer">
            <CalimeroMark size={14} /> Built on Calimero <Icon name="right" size={12} />
          </a>
          <h1>Meeting notes that write themselves, privately.</h1>
          <p className="lede">
            {PRODUCT} records your Google Meet, Zoom and Teams calls from the browser, turns speech into text on your own
            laptop, and keeps the transcript and action items in your team&apos;s workspace. No bot joins the call. The audio
            never leaves your machine.
          </p>
          <div className="row lp-cta">
            {onInstall && (
              <button type="button" className="btn primary large" onClick={onInstall}>
                <Icon name="download" /> Get the extension
              </button>
            )}
            <button type="button" className={onInstall ? "btn large" : "btn primary large"} onClick={onSignIn}>
              Sign in
            </button>
          </div>
          <Available />
        </div>
        <div className="lp-hero-demo">
          <CallDemo />
        </div>
      </section>

      <Reveal className="lp-platforms">
        <span className="dim">Works on the calls you already have</span>
        <ul>
          {PLATFORMS.map((p) => (
            <li key={p}>
              <Icon name="video" /> {p}
            </li>
          ))}
        </ul>
      </Reveal>

      <section id="how" className="lp-section">
        <Reveal>
          <span className="lp-eyebrow">How it works</span>
          <h2 className="lp-h2">Three clicks from call to notes.</h2>
        </Reveal>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 120}>
              <li className="lp-step">
                <span className="lp-step-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="lp-step-icon">{s.icon}</span>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      <section id="private" className="lp-section lp-split">
        <Reveal>
          <span className="lp-eyebrow">Private by design</span>
          <h2 className="lp-h2">Your audio stays on your laptop.</h2>
          <p className="lp-p">
            Recording, speech to text and naming all happen inside your browser. Only the finished text goes to your
            workspace, which lives on your own Calimero node, reachable only by your organization. No one in between
            reads it, us included.
          </p>
          <ul className="lp-checks">
            <li>
              <Icon name="check" size={14} /> No bot in the call, nothing to admit
            </li>
            <li>
              <Icon name="check" size={14} /> Audio is never uploaded or stored
            </li>
            <li>
              <Icon name="check" size={14} /> Passkey sign-in, no passwords
            </li>
          </ul>
        </Reveal>
        <Reveal delay={150}>
          <div className="flow" aria-label="Audio stays in the browser; only text goes to your node" role="img">
            <div className="flow-node">
              <Icon name="mic" size={20} />
              <strong>Your call</strong>
              <span>audio</span>
            </div>
            <div className="flow-link">
              <i />
            </div>
            <div className="flow-node ink">
              <Icon name="puzzle" size={20} />
              <strong>Your browser</strong>
              <span>speech → text</span>
            </div>
            <div className="flow-link text">
              <i />
              <em>text only</em>
            </div>
            <div className="flow-node">
              <CalimeroMark size={20} />
              <strong>Your node</strong>
              <span>workspace</span>
            </div>
          </div>
        </Reveal>
      </section>

      <section className="lp-section">
        <Reveal>
          <span className="lp-eyebrow">Everything in the box</span>
          <h2 className="lp-h2">Notes your team will actually read.</h2>
        </Reveal>
        <ul className="lp-features">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 100}>
              <li>
                <span className="lp-feature-icon">{f.icon}</span>
                <strong>{f.title}</strong>
                <p>{f.body}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </section>

      <section id="open" className="lp-section">
        <Reveal>
          <div className="lp-open">
            <div>
              <span className="lp-eyebrow">Open source</span>
              <h2 className="lp-h2">Read every line of it.</h2>
              <p className="lp-p">
                The extension, the page and the workspace logic are open on GitHub. {PRODUCT} is built on Calimero, a
                framework for private, peer-to-peer apps where your data lives on nodes you control.
              </p>
            </div>
            <div className="lp-open-links">
              <a className="lp-card-link" href={REPO_URL} target="_blank" rel="noreferrer">
                <GitHubMark size={20} />
                <span>
                  <strong>Sylence source</strong>
                  <em>calimero-network/apps</em>
                </span>
                <Icon name="right" size={14} />
              </a>
              <a className="lp-card-link" href={CALIMERO_URL} target="_blank" rel="noreferrer">
                <CalimeroMark size={20} />
                <span>
                  <strong>Calimero</strong>
                  <em>calimero.network</em>
                </span>
                <Icon name="right" size={14} />
              </a>
              <a className="lp-card-link" href={CALIMERO_GITHUB} target="_blank" rel="noreferrer">
                <GitHubMark size={20} />
                <span>
                  <strong>Calimero on GitHub</strong>
                  <em>github.com/calimero-network</em>
                </span>
                <Icon name="right" size={14} />
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      <Reveal className="lp-final">
        <h2 className="lp-h2">Record your next call with {PRODUCT}.</h2>
        <div className="row lp-cta">
          {onInstall && (
            <button type="button" className="btn primary large" onClick={onInstall}>
              <Icon name="download" /> Get the extension
            </button>
          )}
          <button type="button" className={onInstall ? "btn large" : "btn primary large"} onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <Available />
      </Reveal>

      <footer className="lp-footer">
        <div className="brand">
          <img src="./favicon.svg" alt="" width={20} height={20} />
          <span className="brand-name">{PRODUCT}</span>
          <span className="dim">·</span>
          <a href={CALIMERO_URL} target="_blank" rel="noreferrer" className="dim">
            Built on Calimero
          </a>
        </div>
        <nav aria-label="links">
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
      </footer>
    </div>
  );
}
