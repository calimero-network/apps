/**
 * Shared app landing page — the default page a browser gets when nobody is
 * signed in. One implementation, fourteen apps.
 *
 * GENERATED FILE. Source: scripts/landing/template/LandingPage.tsx.
 * `pnpm landing:generate` writes it into every app; `pnpm landing:check` fails
 * CI if a copy drifts. Edit the template, never an app's copy.
 *
 * Per-app content lives in the sibling `landing.config.ts`, and per-app
 * animations in whatever component that config points at. Those two files are
 * the only hand-owned ones, which is what keeps "unified" true after the
 * fourteenth copy.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckSquare,
  Download,
  ExternalLink,
  Monitor,
  Moon,
  Package,
  Sun,
  Wifi,
} from '@calimero-network/mero-icons';

import { CONFIG } from './landing.config';
import './landing.css';

const THEME_KEY = 'cal-lp-theme';

const LINKS = {
  registry: 'https://apps.calimero.network',
  docs: 'https://docs.calimero.network',
  site: 'https://calimero.network',
  download: 'https://calimero.network/download',
  core: 'https://github.com/calimero-network/core',
  x: 'https://x.com/calimeronetwork',
  youtube: 'https://www.youtube.com/@calimeronetwork',
};

const REPO = `https://github.com/calimero-network/apps/tree/main/apps/${CONFIG.dir}`;

/** How it works — identical for every app, because the network is. */
const STEPS = [
  {
    title: 'Run a node',
    body: 'Your own, or the one bundled in the Calimero desktop app. The node is where your data actually lives.',
  },
  {
    title: 'Create a namespace',
    body: 'A private space you own. Everything this app stores goes in it, and nothing leaves it unless you invite someone.',
  },
  {
    title: 'Invite people',
    body: 'Share a link. Their node syncs directly with yours — there is no server in the middle to trust or pay.',
  },
  {
    title: 'Work together',
    body: 'Edits merge as CRDTs, so everyone converges on the same state without a server deciding who won.',
  },
];

const WHY = [
  ['No central server holds your data.', 'The nodes that hold it are yours, or belong to people you invited.'],
  ['Offline edits merge when you reconnect.', 'CRDTs, not last-write-wins, so nobody silently loses work.'],
  ['Membership is a namespace you control.', 'Revoking someone is a thing you do, not a support ticket you file.'],
  ['Open source, and the contract is auditable.', 'You can read exactly what the app stores and who it shares with.'],
];

const SHARED_FAQ = [
  {
    q: 'Do I need to run a server?',
    a: 'No. The Calimero desktop app bundles a node, so installing it is the whole setup. If you already run a node you can point this app at it instead.',
  },
  {
    q: 'Where is my data stored?',
    a: 'On the nodes in your namespace — yours and those of the people you invited. There is no central database holding a copy.',
  },
  {
    q: 'Who can see it?',
    a: 'Only members of the namespace you created. Membership is something you grant and revoke; there is no operator with a way in.',
  },
  {
    q: 'Is it open source?',
    a: 'Yes. Both the frontend and the Rust contract it talks to are in the calimero-network/apps repository, and you can read exactly what the app stores.',
  },
];

/**
 * Reveal is an ENHANCEMENT, never a gate.
 *
 * A headless capture screenshots the page before anything scrolls, so a section
 * that starts at `opacity: 0` and waits for an IntersectionObserver renders
 * BLANK in exactly the artefact used to review it. That has bitten this fleet
 * twice. So the element is fully visible as authored and the observer only adds
 * a class that replays a small translate — remove the observer entirely and the
 * page still reads correctly.
 */
function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('cal-lp-reveal--in');
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  });

  // `null` means "follow the OS", which the CSS already does via
  // prefers-color-scheme. Only an explicit choice stamps the attribute.
  const resolved =
    theme ??
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');

  function toggle() {
    const next = resolved === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* a private window is not a reason to fail */
    }
  }

  return { attr: theme, resolved, toggle };
}

/** The fallback animation, so no app ships with an empty frame. */
function PeerSync() {
  return (
    <div className="cal-lp-sync" aria-hidden="true">
      <div className="cal-lp-peers">
        <div className="cal-lp-wire">
          <span className="cal-lp-packet" />
        </div>
        <span className="cal-lp-peer">
          <Monitor size={19} />
        </span>
        <span className="cal-lp-peer">
          <Package size={19} />
        </span>
        <span className="cal-lp-peer">
          <Wifi size={19} />
        </span>
      </div>
      <div className="cal-lp-rows">
        <span className="cal-lp-row" />
        <span className="cal-lp-row" />
        <span className="cal-lp-row" />
        <span className="cal-lp-row" />
        <span className="cal-lp-row" />
      </div>
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cal-lp-faqrow">
      <button
        type="button"
        className="cal-lp-faqq"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {q}
        <span className="cal-lp-faqsign" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <p className="cal-lp-faqa">{a}</p>}
    </div>
  );
}

export interface LandingPageProps {
  /**
   * Called instead of navigating to `loginPath`, for an app whose sign-in is a
   * modal or a sidebar rather than a route. `mero-sign` is the case: it has no
   * `/login`, and its connect UI lives in a sidebar the page has to open.
   */
  onConnect?: () => void;
}

export default function LandingPage({ onConnect }: LandingPageProps = {}) {
  const theme = useTheme();
  const Animation = CONFIG.animation ?? PeerSync;

  const explainerRef = useReveal();
  const featuresRef = useReveal();
  const stepsRef = useReveal();
  const whyRef = useReveal();
  const bandRef = useReveal();
  const faqRef = useReveal();

  const desktopOnly = CONFIG.availability === 'desktop';
  const webOnly = CONFIG.availability === 'web';
  const loginPath = CONFIG.loginPath ?? '/login';
  const faq = [...SHARED_FAQ, ...(CONFIG.faq ?? [])];

  /** A route for most apps, a callback for the ones whose sign-in is not a page. */
  function ConnectCta({ ghost = false }: { ghost?: boolean }) {
    const cls = `cal-lp-btn ${ghost ? 'cal-lp-btn--ghost' : 'cal-lp-btn--primary'}`;
    return onConnect ? (
      <button type="button" className={cls} onClick={onConnect}>
        Connect to node
      </button>
    ) : (
      <a className={cls} href={loginPath}>
        Connect to node
      </a>
    );
  }

  const availabilityBadge = desktopOnly
    ? { label: 'Desktop only', icon: Monitor, title: `${CONFIG.name} needs the Calimero desktop app for its node and sign-in.` }
    : webOnly
      ? { label: 'Web only', icon: Wifi, title: 'The Calimero desktop is not a supported target for this app. It is not blocked there and does not crash — the desktop integration around it is what is unsupported.' }
      : { label: 'Web + Desktop', icon: CheckSquare, title: 'Runs in a browser against your node, and in the Calimero desktop app.' };

  const AvailIcon = availabilityBadge.icon;

  /** The desktop band. Rendered high up for a desktop-only app, low for the rest. */
  const desktopBand = (
    <div ref={bandRef} className="cal-lp-band cal-lp-reveal">
      <div className="cal-lp-bandtext">
        <h3 className="cal-lp-bandtitle">
          {desktopOnly ? `${CONFIG.name} runs in the Calimero desktop app` : 'Get the Calimero desktop app'}
        </h3>
        <p className="cal-lp-bandbody">
          {desktopOnly
            ? 'It bundles the node this app needs, signs you in, and opens the app in its own window. The web page you are reading is the front door.'
            : 'It bundles a node, so there is nothing to configure and nothing to host. The shortest path from reading about this to using it.'}
        </p>
      </div>
      <a className="cal-lp-btn cal-lp-btn--primary" href={LINKS.download} target="_blank" rel="noreferrer">
        <Download size={17} /> Download for desktop
      </a>
    </div>
  );

  return (
    <div className="cal-lp-root" data-cal-lp-theme={theme.attr ?? undefined}>
      <header className="cal-lp-header">
        <span className="cal-lp-brand">
          <img className="cal-lp-brandicon" src={CONFIG.iconSrc} alt="" width={26} height={26} />
          {CONFIG.name}
        </span>
        <nav className="cal-lp-nav">
          <a className="cal-lp-navlink" href="#about">About</a>
          <a className="cal-lp-navlink" href="#features">Features</a>
          <a className="cal-lp-navlink" href="#how">How it works</a>
          <a className="cal-lp-navlink" href="#faq">FAQ</a>
          <a className="cal-lp-navlink" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <button
          type="button"
          className="cal-lp-iconbtn"
          onClick={theme.toggle}
          aria-label={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          style={{ marginLeft: 'auto' }}
        >
          {theme.resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        {!desktopOnly && <ConnectCta />}
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="cal-lp-shell">
        <section className="cal-lp-hero">
          <div>
            <div className="cal-lp-badges">
              <span className="cal-lp-badge cal-lp-badge--accent">Powered by Calimero</span>
              <span className="cal-lp-badge" title={availabilityBadge.title}>
                <AvailIcon size={13} /> {availabilityBadge.label}
              </span>
              {CONFIG.playableOffline && <span className="cal-lp-badge">Playable offline</span>}
              {CONFIG.experimental && <span className="cal-lp-badge cal-lp-badge--warn">Experimental</span>}
            </div>

            <h1 className="cal-lp-h1">{CONFIG.name}</h1>
            <p className="cal-lp-lede">{CONFIG.tagline}</p>

            <div className="cal-lp-cta">
              {desktopOnly ? (
                <>
                  <a className="cal-lp-btn cal-lp-btn--primary" href={LINKS.download} target="_blank" rel="noreferrer">
                    <Download size={17} /> Get the desktop app
                  </a>
                  <a className="cal-lp-btn cal-lp-btn--ghost" href="#about">
                    What is this?
                  </a>
                </>
              ) : (
                <>
                  <ConnectCta />
                  <a className="cal-lp-btn cal-lp-btn--ghost" href={LINKS.download} target="_blank" rel="noreferrer">
                    <Download size={17} /> Get the desktop app
                  </a>
                </>
              )}
            </div>

            <div className="cal-lp-trust">
              {CONFIG.trust.map((t, i) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  {i > 0 && <span className="cal-lp-trustdot" />}
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="cal-lp-stage">
            <div className="cal-lp-stagebar" aria-hidden="true">
              <span className="cal-lp-stagedot" />
              <span className="cal-lp-stagedot" />
              <span className="cal-lp-stagedot" />
            </div>
            <div className="cal-lp-stagebody">
              <Animation />
            </div>
          </div>
        </section>
      </div>

      {/* A desktop-only app leads with the download, not with a node it cannot reach. */}
      {desktopOnly && (
        <section className="cal-lp-section cal-lp-section--alt">
          <div className="cal-lp-shell">{desktopBand}</div>
        </section>
      )}

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section id="about" className="cal-lp-section">
        <div className="cal-lp-shell">
          <div ref={explainerRef} className="cal-lp-reveal">
            <div className="cal-lp-kicker">What this is</div>
            <h2 className="cal-lp-h2">{CONFIG.name}, in plain terms</h2>
            <div className="cal-lp-prose">
              {CONFIG.explainer.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="cal-lp-section cal-lp-section--alt">
        <div className="cal-lp-shell">
          <div ref={featuresRef} className="cal-lp-reveal">
            <div className="cal-lp-kicker">Features</div>
            <h2 className="cal-lp-h2">What you can do</h2>
            <div className="cal-lp-features">
              {CONFIG.features.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="cal-lp-feature">
                    <span className="cal-lp-featureicon">
                      <Icon size={19} />
                    </span>
                    <div>
                      <h3 className="cal-lp-featuretitle">{f.title}</h3>
                      <p className="cal-lp-featurebody">{f.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="cal-lp-section">
        <div className="cal-lp-shell">
          <div ref={stepsRef} className="cal-lp-reveal">
            <div className="cal-lp-kicker">How it works</div>
            <h2 className="cal-lp-h2">Four steps, no server</h2>
            <p className="cal-lp-sectionsub">
              Every Calimero app works the same way underneath, so learning it once is enough.
            </p>
            <div className="cal-lp-steps">
              {STEPS.map((s, i) => (
                <div key={s.title} className="cal-lp-step">
                  <span className="cal-lp-stepnum">{i + 1}</span>
                  <h3 className="cal-lp-steptitle">{s.title}</h3>
                  <p className="cal-lp-stepbody">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Why p2p ──────────────────────────────────────────────────────── */}
      <section className="cal-lp-section cal-lp-section--alt">
        <div className="cal-lp-shell">
          <div ref={whyRef} className="cal-lp-reveal">
            <div className="cal-lp-kicker">Why peer-to-peer</div>
            <h2 className="cal-lp-h2">The difference it actually makes</h2>
            <ul className="cal-lp-why">
              {WHY.map(([lead, rest]) => (
                <li key={lead} className="cal-lp-whyitem">
                  <span className="cal-lp-whycheck">
                    <CheckSquare size={18} />
                  </span>
                  <span>
                    <strong>{lead}</strong> {rest}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Desktop band, for everyone else ──────────────────────────────── */}
      {!desktopOnly && (
        <section className="cal-lp-section">
          <div className="cal-lp-shell">{desktopBand}</div>
        </section>
      )}

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="cal-lp-section cal-lp-section--alt">
        <div className="cal-lp-shell">
          <div ref={faqRef} className="cal-lp-reveal">
            <div className="cal-lp-kicker">FAQ</div>
            <h2 className="cal-lp-h2">Questions people actually ask</h2>
            <div className="cal-lp-faq">
              {faq.map((f) => (
                <FaqRow key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="cal-lp-footer">
        <div className="cal-lp-shell">
          <div className="cal-lp-footergrid">
            <div>
              <h4 className="cal-lp-footerhead">{CONFIG.name}</h4>
              {onConnect ? (
                <button type="button" className="cal-lp-footerlink" onClick={onConnect} style={{ border: 0, background: 'none', font: 'inherit', cursor: 'pointer', padding: '4px 0' }}>
                  Open the app <ArrowUpRight size={13} />
                </button>
              ) : (
                <a className="cal-lp-footerlink" href={loginPath}>Open the app <ArrowUpRight size={13} /></a>
              )}
              <br />
              <a className="cal-lp-footerlink" href={REPO} target="_blank" rel="noreferrer">Source <ExternalLink size={13} /></a>
            </div>
            <div>
              <h4 className="cal-lp-footerhead">Calimero</h4>
              <a className="cal-lp-footerlink" href={LINKS.site} target="_blank" rel="noreferrer">calimero.network <ExternalLink size={13} /></a>
              <br />
              <a className="cal-lp-footerlink" href={LINKS.docs} target="_blank" rel="noreferrer">Documentation <ExternalLink size={13} /></a>
              <br />
              <a className="cal-lp-footerlink" href={LINKS.registry} target="_blank" rel="noreferrer">App registry <ExternalLink size={13} /></a>
            </div>
            <div>
              <h4 className="cal-lp-footerhead">Get started</h4>
              <a className="cal-lp-footerlink" href={LINKS.download} target="_blank" rel="noreferrer">Download desktop <ExternalLink size={13} /></a>
              <br />
              <a className="cal-lp-footerlink" href={LINKS.core} target="_blank" rel="noreferrer">Calimero core <ExternalLink size={13} /></a>
            </div>
            <div>
              <h4 className="cal-lp-footerhead">Community</h4>
              <a className="cal-lp-footerlink" href={LINKS.x} target="_blank" rel="noreferrer">X <ExternalLink size={13} /></a>
              <br />
              <a className="cal-lp-footerlink" href={LINKS.youtube} target="_blank" rel="noreferrer">YouTube <ExternalLink size={13} /></a>
            </div>
          </div>
          <div className="cal-lp-footerbase">
            <span>{CONFIG.packageId}</span>
            <span className="cal-lp-trustdot" />
            <span>Open source, MIT</span>
            <span className="cal-lp-trustdot" />
            <span>Built on Calimero</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
