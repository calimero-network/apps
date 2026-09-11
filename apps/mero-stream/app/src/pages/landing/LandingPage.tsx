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
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
import type { IconComponent } from './landingTypes';
import './landing.css';

const THEME_KEY = 'cal-lp-theme';
/**
 * Four apps (mero-calendar, mero-meet, mero-sheets, mero-issue-tracker) already
 * ship their own light/dark switch, each reading `<html data-theme>` and its own
 * localStorage key. Where the app declares that key, the landing toggle writes
 * it too — otherwise the front door and the app behind it would be two switches
 * that disagree, and the choice would be lost the moment you signed in.
 */
const HOST_THEME_KEY = CONFIG.themeStorageKey;

/**
 * What the landing page was last TOLD to be, by its own toggle. Nothing else.
 *
 * ⚠️ Reads only `THEME_KEY`, and this is load-bearing — both of the other
 * plausible sources are OS preference in disguise:
 *
 *   - `<html data-theme>` cannot say whether the host is dark because somebody
 *     asked for dark or merely because the OS is;
 *   - `HOST_THEME_KEY` looks like a stored choice and is not. mero-calendar's
 *     ThemeProvider (mero-meet, mero-sheets and mero-issue-tracker are the
 *     same shape) seeds its state from `prefers-color-scheme` and then WRITES
 *     that straight to localStorage in a mount effect. So on an OS-dark
 *     machine the first visit is light — the effect has not run yet — and
 *     every visit after it is dark. Measured, not theorised.
 *
 * The toggle still writes both keys, so a choice made here carries into the
 * app. The direction that leaked is the one that is closed.
 */
function readStoredTheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* a private window is not a reason to fail */
  }
  return null;
}

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
    // The reveal is an enhancement, so every reason to skip it is a plain
    // return — including jsdom, which implements no IntersectionObserver at all
    // and would otherwise throw on mount inside a unit test.
    if (typeof IntersectionObserver === 'undefined') return;
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

/**
 * The width every hero animation is drawn against.
 *
 * Open any app's `animation.tsx` and the coordinates are literal pixels —
 * `left: 20, top: 32 + i * 32`. The stage they sit in is fluid: 896px wide on a
 * 940px tablet, 328px on a 360px phone, 495px on the desktop layout they were
 * authored in. So the same mock renders half-empty on a tablet and with its
 * rows written over each other on a phone, which is what a 360px capture showed.
 */
const STAGE_DESIGN_W = 495;

/**
 * Scales the animation box so it always renders as drawn.
 *
 * ResizeObserver is the exact measurement — the stage's width depends on the
 * hero grid, not on the viewport, so a media query can only approximate it. It
 * is absent in jsdom for the same reason IntersectionObserver is, so this stays
 * optional: without it the element keeps the breakpoint fallbacks in the CSS.
 */
function useStageScale<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) el.style.setProperty('--cal-lp-a-s', String(w / STAGE_DESIGN_W));
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

/**
 * Which of the three pages this is: `/` overview, `/docs`, `/preview`.
 *
 * ⚠️ Deliberately NOT react-router, and deliberately NOT the URL hash.
 *
 * Not react-router, because two of the fourteen apps (the canvas games) have no
 * router at all — they render this page into a detached root from `main.ts` —
 * and two more render it from a bare `if (!isAuthenticated)` with no route
 * around it. A router-based split would need four different integrations and
 * would break in the two places that have nothing to integrate with.
 *
 * Not the hash, because the desktop hands an app its SSO tokens in the URL
 * fragment. `#docs` would sit in the same slot as a brokered login and is a
 * collision waiting to happen.
 *
 * So: read `location.pathname`, navigate with `pushState`, listen for
 * `popstate` so the back button works. Every app's Vercel config already
 * rewrites unknown paths to `index.html`, so `/docs` is a real shareable link.
 * The twelve router apps additionally route those paths back to this page, or
 * their own catch-all would swallow the deep link.
 */
type View = 'overview' | 'docs' | 'preview';

const VIEW_PATH: Record<View, string> = {
  overview: '/',
  docs: '/docs',
  preview: '/preview',
};

/**
 * Matched on the END of the path, not the whole of it: `mero-stream` and
 * `mero-meet` render this page for ANY path while signed out, so an exact
 * comparison would show the overview at `/docs`.
 */
function viewFromPath(path: string): View {
  if (/\/docs\/?$/.test(path)) return 'docs';
  if (/\/preview\/?$/.test(path)) return 'preview';
  return 'overview';
}

function useLandingView() {
  const [view, setView] = useState<View>(() =>
    typeof window === 'undefined' ? 'overview' : viewFromPath(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function go(next: View) {
    if (next !== view) {
      try {
        window.history.pushState(null, '', VIEW_PATH[next]);
      } catch {
        /* a sandboxed iframe cannot pushState; the view still changes */
      }
      setView(next);
      window.scrollTo({ top: 0 });
    }
  }

  return { view, go };
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(readStoredTheme);

  // ⚠️ LIGHT, not the OS. A landing page is the first thing a stranger sees and
  // the same page in a screenshot, a review and a share card, so it looks the
  // same for everyone until someone asks for dark. `landing.css` agrees: it
  // carries no prefers-color-scheme rule at all, so there is one default here
  // and not a second one hidden in the stylesheet.
  const resolved = theme ?? 'light';

  // Mirrored onto <html> as well as the landing root: that attribute is what an
  // app's own theme CSS keys off, so the choice survives the walk from this page
  // into the app. An app with no theme of its own simply matches no rule.
  useEffect(() => {
    if (theme === null) return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggle() {
    const next = resolved === 'dark' ? 'light' : 'dark';
    setTheme(next);
    for (const key of [THEME_KEY, HOST_THEME_KEY]) {
      if (!key) continue;
      try {
        localStorage.setItem(key, next);
      } catch {
        /* a private window is not a reason to fail */
      }
    }
  }

  // Always stamped, never left off. `light` matches no override block — the
  // base tokens are already light — but the attribute is the page's statement
  // of which theme it is in, which is what a test and a reader can both check.
  return { attr: resolved, resolved, toggle };
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
  const { view, go } = useLandingView();
  const [loginOpen, setLoginOpen] = useState(false);

  const Animation = CONFIG.animation ?? PeerSync;
  const LoginPopup = CONFIG.loginPopup;

  const desktopOnly = CONFIG.availability === 'desktop';
  const webOnly = CONFIG.availability === 'web';
  const faq = [...SHARED_FAQ, ...(CONFIG.faq ?? [])];

  /**
   * ⚠️ There is no `/login` page any more, on any of the fourteen apps.
   *
   * Every one of them had one, and every one looked different: a heading, the
   * app's description, a `<ConnectButton/>`, and whatever styling that app
   * happened to use. It was a whole route whose only job was to render a button
   * the visitor had already pressed to get there — so the first thing they saw
   * after a considered landing page was a second, unrelated-looking page asking
   * them to click again.
   *
   * The popup does node discovery and manual URL entry, then `connectToNode`
   * takes over: the node signs the visitor in and the app's own route guard
   * puts them where they were going. One click, no intermediate page, and the
   * app's own design starts where the app does.
   *
   * `onConnect` still wins where an app's sign-in genuinely is not a popup:
   * `mero-sign` opens its sidebar, and the two games resolve their launcher.
   */
  const connect = onConnect ?? (LoginPopup ? () => setLoginOpen(true) : undefined);

  function ConnectCta({ ghost = false }: { ghost?: boolean }) {
    const cls = `cal-lp-btn ${ghost ? 'cal-lp-btn--ghost' : 'cal-lp-btn--primary'}`;
    return (
      <button type="button" className={cls} onClick={connect} disabled={!connect}>
        Connect to node
      </button>
    );
  }

  const availabilityBadge = desktopOnly
    ? { label: 'Desktop only', icon: Monitor, title: `${CONFIG.name} needs the Calimero desktop app for its node and sign-in.` }
    : webOnly
      ? { label: 'Web only', icon: Wifi, title: 'The Calimero desktop is not a supported target for this app. It is not blocked there and does not crash — the desktop integration around it is what is unsupported.' }
      : { label: 'Web + Desktop', icon: CheckSquare, title: 'Runs in a browser against your node, and in the Calimero desktop app.' };

  const AvailIcon = availabilityBadge.icon;

  /** A nav link that is a real URL and also a client-side move. */
  function NavLink({ to, children }: { to: View; children: ReactNode }) {
    return (
      <a
        className="cal-lp-navlink"
        href={VIEW_PATH[to]}
        aria-current={view === to ? 'page' : undefined}
        data-cal-lp-active={view === to ? '' : undefined}
        onClick={(e) => {
          // Let a modified click do what the browser would: new tab, new window,
          // download. Only a plain left click is ours to intercept.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          go(to);
        }}
      >
        {children}
      </a>
    );
  }

  /** The desktop band. Rendered high up for a desktop-only app, low for the rest. */
  const desktopBand = (
    <div className="cal-lp-band cal-lp-reveal">
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
    <div className="cal-lp-root" data-cal-lp-theme={theme.attr} data-cal-lp-view={view}>
      <header className="cal-lp-header">
        <a
          className="cal-lp-brand"
          href="/"
          aria-label={CONFIG.name}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            go('overview');
          }}
        >
          <img className="cal-lp-brandicon" src={CONFIG.markSrc} alt="" width={24} height={24} />
          <span className="cal-lp-brandname">{CONFIG.name}</span>
        </a>
        <nav className="cal-lp-nav">
          <NavLink to="overview">Overview</NavLink>
          <NavLink to="docs">Docs</NavLink>
          <NavLink to="preview">Preview</NavLink>
          <a className="cal-lp-navlink" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <span className="cal-lp-headerend">{!desktopOnly && <ConnectCta />}</span>
      </header>

      {view === 'overview' && (
        <OverviewView
          Animation={Animation}
          ConnectCta={ConnectCta}
          AvailIcon={AvailIcon}
          availabilityBadge={availabilityBadge}
          desktopOnly={desktopOnly}
          desktopBand={desktopBand}
          go={go}
        />
      )}

      {view === 'docs' && <DocsView faq={faq} ConnectCta={ConnectCta} desktopOnly={desktopOnly} />}

      {view === 'preview' && (
        <PreviewView Animation={Animation} ConnectCta={ConnectCta} desktopOnly={desktopOnly} go={go} />
      )}

      <footer className="cal-lp-footer">
        <div className="cal-lp-shell">
          <div className="cal-lp-footergrid">
            <div>
              <h4 className="cal-lp-footerhead">{CONFIG.name}</h4>
              <a
                className="cal-lp-footerlink"
                href={VIEW_PATH.docs}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  go('docs');
                }}
              >
                Documentation <ArrowUpRight size={13} />
              </a>
              <br />
              <a
                className="cal-lp-footerlink"
                href={VIEW_PATH.preview}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  go('preview');
                }}
              >
                Preview <ArrowUpRight size={13} />
              </a>
              <br />
              <a className="cal-lp-footerlink" href={REPO} target="_blank" rel="noreferrer">
                Source <ExternalLink size={13} />
              </a>
            </div>
            <div>
              <h4 className="cal-lp-footerhead">Calimero</h4>
              <a className="cal-lp-footerlink" href={LINKS.site} target="_blank" rel="noreferrer">calimero.network <ExternalLink size={13} /></a>
              <br />
              <a className="cal-lp-footerlink" href={LINKS.docs} target="_blank" rel="noreferrer">Platform docs <ExternalLink size={13} /></a>
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
            {/* The theme switch lives here, not in the header. The header's job
                is to say what this is and offer the way in; a light/dark control
                is a preference, and preferences belong with the other small
                print. */}
            <button
              type="button"
              className="cal-lp-themebtn"
              data-testid="theme-toggle"
              onClick={theme.toggle}
              aria-label={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme.resolved === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              {theme.resolved === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </footer>

      {/* ⚠️ `!onConnect` as well as `LoginPopup`, and not redundantly. The popup
          calls `useMero()`, which throws outside a `MeroProvider` — and an app
          that passes `onConnect` may well be rendering this page outside one,
          which is exactly what both canvas games do. */}
      {!onConnect && LoginPopup && (
        <LoginPopup isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The three views.

   Split because one page was doing three jobs at once: convincing somebody
   this is worth a click, explaining how it actually works, and showing it
   moving. Each of those wants a different length and a different reader, and
   stacking all three made the first one scroll past the second.
   ══════════════════════════════════════════════════════════════════════════ */

interface ViewShared {
  ConnectCta: ComponentType<{ ghost?: boolean }>;
  desktopOnly: boolean;
}

/** `/` — what this is, what it does, and the way in. Short on purpose. */
function OverviewView({
  Animation,
  ConnectCta,
  AvailIcon,
  availabilityBadge,
  desktopOnly,
  desktopBand,
  go,
}: ViewShared & {
  Animation: ComponentType;
  AvailIcon: IconComponent;
  availabilityBadge: { label: string; title: string };
  desktopBand: ReactNode;
  go: (v: View) => void;
}) {
  const featuresRef = useReveal();
  const stageRef = useStageScale();

  return (
    <>
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
                  <a
                    className="cal-lp-btn cal-lp-btn--ghost"
                    href={VIEW_PATH.docs}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      go('docs');
                    }}
                  >
                    Read the docs
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

          {/* ⚠️ The link is a SIBLING of the stage, not a child. `.cal-lp-stage`
              is `overflow: hidden` so the animation cannot spill out of its
              frame — which also clips anything else put inside it, and the
              link rendered on top of the artwork. */}
          <div className="cal-lp-stagewrap">
            <div className="cal-lp-stage">
              <div className="cal-lp-stagebar" aria-hidden="true">
                <span className="cal-lp-stagedot" />
                <span className="cal-lp-stagedot" />
                <span className="cal-lp-stagedot" />
              </div>
              <div className="cal-lp-stagebody" ref={stageRef}>
                <Animation />
              </div>
            </div>
            <a
              className="cal-lp-stagelink"
              href={VIEW_PATH.preview}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                go('preview');
              }}
            >
              See it larger <ArrowUpRight size={13} />
            </a>
          </div>
        </section>
      </div>

      {desktopOnly && (
        <section className="cal-lp-section cal-lp-section--alt">
          <div className="cal-lp-shell">{desktopBand}</div>
        </section>
      )}

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
            <p className="cal-lp-sectionsub" style={{ marginTop: 28 }}>
              <a
                className="cal-lp-inlinelink"
                href={VIEW_PATH.docs}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  go('docs');
                }}
              >
                How {CONFIG.name} actually works <ArrowUpRight size={13} />
              </a>
            </p>
          </div>
        </div>
      </section>

      {!desktopOnly && (
        <section className="cal-lp-section">
          <div className="cal-lp-shell">{desktopBand}</div>
        </section>
      )}
    </>
  );
}

/** `/docs` — the real documentation for this app, not a link to somebody else's. */
function DocsView({ faq, ConnectCta, desktopOnly }: ViewShared & { faq: { q: string; a: string }[] }) {
  const toc = [
    { id: 'about', heading: 'What this is' },
    ...CONFIG.docs.map((d) => ({ id: d.id, heading: d.heading })),
    { id: 'how', heading: 'How Calimero works' },
    { id: 'faq', heading: 'FAQ' },
  ];

  return (
    <div className="cal-lp-shell">
      <div className="cal-lp-docshead">
        <div className="cal-lp-kicker">Documentation</div>
        <h1 className="cal-lp-h1 cal-lp-h1--docs">{CONFIG.name}</h1>
        <p className="cal-lp-lede">{CONFIG.tagline}</p>
      </div>

      <div className="cal-lp-docs">
        {/* Sticky on a wide screen, a plain list above the prose on a phone. */}
        <nav className="cal-lp-toc" aria-label="On this page">
          <h4 className="cal-lp-footerhead">On this page</h4>
          {toc.map((t) => (
            <a key={t.id} className="cal-lp-toclink" href={`#${t.id}`}>
              {t.heading}
            </a>
          ))}
        </nav>

        <div className="cal-lp-docsbody">
          <section id="about" className="cal-lp-docsection">
            <h2 className="cal-lp-h2">What this is</h2>
            <div className="cal-lp-prose">
              {CONFIG.explainer.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
          </section>

          {CONFIG.docs.map((d) => (
            <section key={d.id} id={d.id} className="cal-lp-docsection">
              <h2 className="cal-lp-h2">{d.heading}</h2>
              {d.paragraphs && (
                <div className="cal-lp-prose">
                  {d.paragraphs.map((p) => (
                    <p key={p.slice(0, 24)}>{p}</p>
                  ))}
                </div>
              )}
              {d.concepts && (
                <dl className="cal-lp-concepts">
                  {d.concepts.map((c) => (
                    <div key={c.term} className="cal-lp-concept">
                      <dt className="cal-lp-conceptterm">{c.term}</dt>
                      <dd className="cal-lp-conceptdef">{c.def}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {d.steps && (
                <div className="cal-lp-steps cal-lp-steps--docs">
                  {d.steps.map((st, i) => (
                    <div key={st.title} className="cal-lp-step">
                      <span className="cal-lp-stepnum">{i + 1}</span>
                      <h3 className="cal-lp-steptitle">{st.title}</h3>
                      <p className="cal-lp-stepbody">{st.body}</p>
                    </div>
                  ))}
                </div>
              )}
              {d.bullets && (
                <ul className="cal-lp-why">
                  {d.bullets.map((b) => (
                    <li key={b.slice(0, 24)} className="cal-lp-whyitem">
                      <span className="cal-lp-whycheck">
                        <CheckSquare size={18} />
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section id="how" className="cal-lp-docsection">
            <h2 className="cal-lp-h2">How Calimero works</h2>
            <p className="cal-lp-sectionsub">
              Every Calimero app works the same way underneath, so learning it once is enough.
            </p>
            <div className="cal-lp-steps cal-lp-steps--docs">
              {STEPS.map((st, i) => (
                <div key={st.title} className="cal-lp-step">
                  <span className="cal-lp-stepnum">{i + 1}</span>
                  <h3 className="cal-lp-steptitle">{st.title}</h3>
                  <p className="cal-lp-stepbody">{st.body}</p>
                </div>
              ))}
            </div>
            <ul className="cal-lp-why" style={{ marginTop: 30 }}>
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
          </section>

          <section id="faq" className="cal-lp-docsection">
            <h2 className="cal-lp-h2">FAQ</h2>
            <div className="cal-lp-faq">
              {faq.map((f) => (
                <FaqRow key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </section>

          {!desktopOnly && (
            <div className="cal-lp-band" style={{ marginTop: 8 }}>
              <div className="cal-lp-bandtext">
                <h3 className="cal-lp-bandtitle">Ready to try it?</h3>
                <p className="cal-lp-bandbody">
                  Connect a node and {CONFIG.name} opens straight away — there is no account to create.
                </p>
              </div>
              <ConnectCta />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** `/preview` — the animation at full size, with the beats spelled out. */
function PreviewView({
  Animation,
  ConnectCta,
  desktopOnly,
  go,
}: ViewShared & { Animation: ComponentType; go: (v: View) => void }) {
  const stageRef = useStageScale();

  return (
    <div className="cal-lp-shell">
      <div className="cal-lp-docshead">
        <div className="cal-lp-kicker">Preview</div>
        <h1 className="cal-lp-h1 cal-lp-h1--docs">{CONFIG.name} in motion</h1>
        <p className="cal-lp-lede">
          A mock of the real interface, running on a loop. Nothing here is a screenshot — it is the
          same markup the page draws everywhere else, at full size.
        </p>
      </div>

      <div className="cal-lp-previewwrap">
        <div className="cal-lp-stage cal-lp-stage--big">
          <div className="cal-lp-stagebar" aria-hidden="true">
            <span className="cal-lp-stagedot" />
            <span className="cal-lp-stagedot" />
            <span className="cal-lp-stagedot" />
          </div>
          <div className="cal-lp-stagebody" ref={stageRef}>
            <Animation />
          </div>
        </div>

        <ol className="cal-lp-beats">
          {CONFIG.previewSteps.map((s, i) => (
            <li key={s.title} className="cal-lp-beat">
              <span className="cal-lp-stepnum">{i + 1}</span>
              <div>
                <h3 className="cal-lp-steptitle">{s.title}</h3>
                <p className="cal-lp-stepbody">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="cal-lp-band" style={{ marginBottom: 70 }}>
        <div className="cal-lp-bandtext">
          <h3 className="cal-lp-bandtitle">Try it on your own node</h3>
          <p className="cal-lp-bandbody">
            {desktopOnly
              ? 'The Calimero desktop app bundles the node this needs and opens the app in its own window.'
              : 'Connect a node and the real thing opens — same layout, your data.'}
          </p>
        </div>
        {desktopOnly ? (
          <a className="cal-lp-btn cal-lp-btn--primary" href={LINKS.download} target="_blank" rel="noreferrer">
            <Download size={17} /> Get the desktop app
          </a>
        ) : (
          <ConnectCta />
        )}
      </div>

      <p className="cal-lp-sectionsub" style={{ paddingBottom: 60 }}>
        <a
          className="cal-lp-inlinelink"
          href={VIEW_PATH.docs}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            go('docs');
          }}
        >
          Read how it works <ArrowUpRight size={13} />
        </a>
      </p>
    </div>
  );
}
