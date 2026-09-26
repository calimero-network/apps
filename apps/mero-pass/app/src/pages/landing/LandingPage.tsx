/**
 * Mero Pass's front door — the page a browser gets when nobody is signed in.
 *
 * HAND-OWNED. Mero Pass left the fleet-wide generated landing
 * (`scripts/landing/`) so its page could be built in the calimero.network
 * language the Calimero landing, Calimero Cloud, the App Registry and the
 * desktop app share: charcoal, Power Grotesk, square hairline grids, one lime,
 * numbered chapters, a lime Cloud band. The structure follows the Calimero
 * home page and the Cloud marketing site — hero with a live product shot,
 * chapters, the band, a comparison, an FAQ, a closing call — so the four read
 * as one family.
 *
 * Dark only, like those pages: the marketing surfaces are charcoal whatever the
 * app's own theme choice is (`.mp-ld` carries its own tokens).
 *
 * `/`, `/landing`, `/docs` and `/preview` all render it (see `App.tsx`);
 * `/docs` and `/preview` open at the chapter that answers them.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { LoginModal, useMero } from '@calimero-network/mero-react';
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Cloud,
  CloudX,
  Download,
  Eye,
  FileClock,
  Heart,
  Lock,
  LockBox,
  Monitor,
  Refresh,
  ShieldCheck,
  Upload,
} from '@calimero-network/mero-icons';

import BrandMark from '../../components/BrandMark';
import Wordmark from '../../components/Wordmark';
import { MARK_BG } from '../../lib/brandMark';
import VaultPreview from './VaultPreview';
import './landing.css';

const LINKS = {
  site: 'https://calimero.network',
  download: 'https://calimero.network/download',
  cloud: 'https://cloud.calimero.network',
  registry: 'https://apps.calimero.network',
  docs: 'https://docs.calimero.network',
  core: 'https://github.com/calimero-network/core',
  repo: 'https://github.com/calimero-network/apps/tree/main/apps/mero-pass',
  security:
    'https://github.com/calimero-network/apps/tree/main/apps/mero-pass#encryption',
  x: 'https://x.com/CalimeroNetwork',
};

/**
 * The node picker in the same language: mero-react's LoginModal takes theme
 * tokens, so it gets the charcoal, the lime and square corners.
 */
const LOGIN_THEME = {
  primary: '#a4ff11',
  primaryHover: '#b8ff4a',
  primaryText: '#131215',
  background: '#1a191c',
  backgroundSecondary: '#131215',
  backgroundTertiary: '#211f23',
  border: '#404040',
  text: '#fcfcfc',
  textSecondary: '#8e8e8e',
  error: '#ff6b6b',
  overlay: 'rgba(0, 0, 0, 0.72)',
  radius: '0',
};

/** The chapters, in page order. The header links to four of them. */
const NAV = [
  { id: 'difference', label: 'Why' },
  { id: 'how', label: 'How it works' },
  { id: 'security', label: 'Security' },
  { id: 'compare', label: 'Compare' },
  { id: 'faq', label: 'FAQ' },
];

/** `/docs` and `/preview` open at the chapter that answers them. */
const ENTRY_ANCHOR: Record<string, string> = {
  '/docs': 'how',
  '/preview': 'inside',
};

function Ext({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** "01 ── The difference": the numbered marker every chapter opens with. */
function Chapter({
  n,
  label,
  id,
  slim,
  children,
}: {
  n: string;
  label: string;
  id: string;
  slim?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`mp-ld-chapter ${slim ? 'mp-ld-chapter--slim' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="mp-ld-grid">
        <div className="mp-ld-chapter__inner">
          <p className="mp-ld-marker">
            <span className="mp-ld-marker__n">{n}</span>
            <span className="mp-ld-marker__rule" />
            <span className="mp-ld-marker__label">{label}</span>
          </p>
          {children}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'A key per browser',
    body: 'Each browser makes a P-256 key pair it cannot export. Seal it under a passkey or a passphrase and nothing usable is left on disk.',
  },
  {
    title: 'A key per vault',
    body: 'Every vault has its own AES-256 key, wrapped to each approved device. The node stores the wraps; only a device can open one.',
  },
  {
    title: 'Sealed field by field',
    body: 'Names, passwords, notes and tags are encrypted in your browser, each bound to its secret and field, before anything is sent.',
  },
  {
    title: 'Synced peer to peer',
    body: 'Changes replicate between members’ nodes as CRDTs. Two people editing different fields both win; roles are checked by every peer.',
  },
];

const INSIDE: { icon: typeof Lock; title: string; body: string }[] = [
  {
    icon: LockBox,
    title: 'Six kinds of secret',
    body: 'Logins, secure notes, authenticator seeds, SSH keys, payment cards and identities.',
  },
  {
    icon: Clock,
    title: 'Live authenticator codes',
    body: 'TOTP codes computed in your browser from a seed that is only ever stored sealed.',
  },
  {
    icon: FileClock,
    title: 'History and trash',
    body: 'Every earlier value is kept, still sealed, and restorable. Trash is recoverable until an Admin purges it.',
  },
  {
    icon: Heart,
    title: 'Password health',
    body: 'Weak, reused and stale passwords, plus an opt-in breach check that sends only five characters of a hash.',
  },
  {
    icon: ArrowUpRight,
    title: 'Share one secret',
    body: 'A link for someone outside the team, sealed inside the URL fragment, with an optional passphrase and an expiry.',
  },
  {
    icon: Upload,
    title: 'Import, and export sealed',
    body: 'Bring your Bitwarden, 1Password or browser CSV. Export is an encrypted backup only — never a plaintext file.',
  },
];

const RISKS: { icon: typeof Lock; title: string; body: string }[] = [
  {
    icon: Monitor,
    title: 'You lose a browser',
    body: 'Enter your recovery code in any browser and every vault comes back. Or approve the new browser from another device of yours.',
  },
  {
    icon: Lock,
    title: 'A laptop is stolen',
    body: 'Locked behind a passkey or passphrase, it holds ciphertext and a sealed key. Revoke it and the vault key rotates.',
  },
  {
    icon: Refresh,
    title: 'Someone leaves the team',
    body: 'Remove them and the key rotates and every secret is re-sealed. Nothing written afterwards opens for them.',
  },
  {
    icon: Eye,
    title: 'Someone gets into your account',
    body: 'A new browser on your account gets nothing until one of yours approves it, comparing a six-digit code.',
  },
];

const COMPARE: [string, string, string][] = [
  [
    'Where the vault lives',
    'On your team’s own nodes',
    'In the provider’s cloud, with every customer’s',
  ],
  [
    'What a breach of the host yields',
    'Ciphertext, with no master password to crack',
    'Every vault, open to offline password guessing',
  ],
  [
    'Who enforces roles',
    'Every peer, when it merges a change',
    'The provider’s servers',
  ],
  [
    'Works offline',
    'Yes — local-first, syncs later',
    'Read-only cache, usually',
  ],
  [
    'Recovery',
    'Your recovery code, or another device',
    'Account recovery run by the provider',
  ],
  ['Source', 'Open, contract and client', 'Varies; servers closed'],
  ['Browser autofill', 'Not yet', 'Yes'],
];

const FAQ: [string, string][] = [
  [
    'Can the node operator read my passwords?',
    'No. Nodes — yours, a teammate’s, or a Calimero Cloud node — only ever hold ciphertext and key wraps. Decryption happens in a browser that holds a device key the vault key was wrapped to.',
  ],
  [
    'What if I lose every device?',
    'Use your recovery key: a 56-character code shown once when you create it. Entered in any browser, it restores every vault it was given. Without it, a vault only you held cannot be opened — by anyone, including us.',
  ],
  [
    'Is there a master password?',
    'No. Each browser has its own key, sealed under a passkey or a passphrase if you choose. There is no single password whose leak opens everything.',
  ],
  [
    'How do teammates get access?',
    'Invite them to a team or an invite-only vault. When they open it, any member holding the key hands it to their browser — no admin has to be online.',
  ],
  [
    'Do I need to run a server?',
    'You need a Calimero node. Calimero Desktop bundles one, so there is nothing to configure; Calimero Cloud keeps one online for you around the clock.',
  ],
  [
    'What happens when two people edit the same secret?',
    'Every field is its own register. Edits to different fields both survive; edits to the same field resolve by time, and the earlier value stays in history.',
  ],
];

export default function LandingPage() {
  const { connectToNode } = useMero();
  const { pathname } = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const anchor = ENTRY_ANCHOR[pathname];
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [pathname]);

  const connect = () => setLoginOpen(true);

  return (
    <div className="mp-ld" data-testid="landing">
      <div className="mp-ld-lines" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={`mp-ld-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="mp-ld-header__inner">
          <a href="/" className="mp-ld-header__brand" aria-label="Mero Pass">
            <Wordmark />
          </a>
          <nav className="mp-ld-header__nav" aria-label="Page">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="mp-ld-btn mp-ld-btn--secondary mp-ld-btn--small"
            onClick={connect}
          >
            <span className="mp-ld-long">Connect to node</span>
            <span className="mp-ld-short">Connect</span>
          </button>
        </div>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="mp-ld-hero">
          <div className="mp-ld-grid">
            <div className="mp-ld-hero__content">
              <p className="mp-ld-eyebrow">Mero Pass · a Calimero app</p>
              <h1 className="mp-ld-hero__title">
                Your team’s passwords.
                <span>On your devices. Nobody else’s.</span>
              </h1>
              <p className="mp-ld-lede">
                A password manager with no vault in someone else’s cloud.
                Secrets are encrypted in your browser, synced between your
                team’s own nodes, and readable only on the devices you approve.
              </p>
              <div className="mp-ld-actions">
                <button
                  type="button"
                  className="mp-ld-btn mp-ld-btn--primary"
                  onClick={connect}
                >
                  Connect to node
                </button>
                <Ext
                  href={LINKS.download}
                  className="mp-ld-btn mp-ld-btn--secondary"
                >
                  Get Calimero Desktop
                </Ext>
              </div>
              <p className="mp-ld-meta">
                End-to-end encrypted · Web · macOS · Windows · Linux · Open
                source
              </p>
            </div>
            <div className="mp-ld-hero__shot">
              <VaultPreview />
            </div>
          </div>
        </section>

        {/* ── 01 The difference ────────────────────────────────────────── */}
        <Chapter n="01" label="The difference" id="difference">
          <h2 id="difference-title" className="mp-ld-title">
            A password manager with no vault to breach.
          </h2>
          <div className="mp-ld-versus">
            <div className="mp-ld-panel">
              <p className="mp-ld-kicker mp-ld-kicker--muted">Today</p>
              <h3 className="mp-ld-panel__title">
                One company holds everyone’s vault
              </h3>
              <ul className="mp-ld-ticks mp-ld-ticks--muted">
                <li>Every customer’s encrypted vault sits in one database.</li>
                <li>
                  A breach hands attackers all of them, to guess master
                  passwords offline at leisure.
                </li>
                <li>Access and recovery are rules on someone else’s server.</li>
              </ul>
            </div>
            <div className="mp-ld-panel mp-ld-panel--brand">
              <p className="mp-ld-kicker">Mero Pass</p>
              <h3 className="mp-ld-panel__title">
                Your team holds its own, sealed
              </h3>
              <ul className="mp-ld-ticks">
                <li>Vaults replicate only between your team’s nodes.</li>
                <li>
                  Nodes store ciphertext and key wraps. There is no master
                  password to guess.
                </li>
                <li>Roles are checked by every peer, not by a vendor.</li>
              </ul>
            </div>
          </div>

          <div
            className="mp-ld-sealed"
            aria-label="What you see and what a node stores"
          >
            <div className="mp-ld-sealed__col">
              <p className="mp-ld-sealed__cap">What you see</p>
              <dl>
                <dt>name</dt>
                <dd>GitHub</dd>
                <dt>username</dt>
                <dd>ada@acme.example</dd>
                <dt>password</dt>
                <dd className="mp-ld-sealed__lime">tr7-Kq2-9xF-vW4</dd>
              </dl>
            </div>
            <div className="mp-ld-sealed__col">
              <p className="mp-ld-sealed__cap">What every node stores</p>
              <dl>
                <dt>name</dt>
                <dd>mp1.3f9a…c21e.Jx8Qw2…</dd>
                <dt>username</dt>
                <dd>mp1.3f9a…c21e.p0LmZ7…</dd>
                <dt>password</dt>
                <dd>mp1.3f9a…c21e.9dKs1V…</dd>
              </dl>
            </div>
          </div>
        </Chapter>

        {/* ── 02 How it works ──────────────────────────────────────────── */}
        <Chapter n="02" label="How it works" id="how">
          <h2 id="how-title" className="mp-ld-title">
            Four keys deep, and none of them on a server.
          </h2>
          <ol className="mp-ld-flow">
            {STEPS.map((s, i) => (
              <li key={s.title} className="mp-ld-flow__step">
                <span className="mp-ld-flow__n">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mp-ld-flow__title">{s.title}</h3>
                <p className="mp-ld-flow__body">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mp-ld-note">
            AES-256-GCM for fields, ECDH P-256 with HKDF for key wraps, all
            through the browser’s own WebCrypto.{' '}
            <Ext href={LINKS.security} className="mp-ld-link">
              Read the security model
            </Ext>
          </p>
        </Chapter>

        {/* ── 03 What’s inside ─────────────────────────────────────────── */}
        <Chapter n="03" label="What’s inside" id="inside">
          <h2 id="inside-title" className="mp-ld-title">
            Everything a team shares, in one sealed place.
          </h2>
          <ul className="mp-ld-cards">
            {INSIDE.map(({ icon: Icon, title, body }) => (
              <li key={title} className="mp-ld-card">
                <span className="mp-ld-card__icon">
                  <Icon size={28} />
                </span>
                <h3 className="mp-ld-card__title">{title}</h3>
                <p className="mp-ld-card__body">{body}</p>
              </li>
            ))}
          </ul>
        </Chapter>

        {/* ── 04 Security ──────────────────────────────────────────────── */}
        <Chapter n="04" label="When things go wrong" id="security">
          <h2 id="security-title" className="mp-ld-title">
            Built for the bad day, not just the good one.
          </h2>
          <ul className="mp-ld-benefits">
            {RISKS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="mp-ld-benefits__item">
                <span className="mp-ld-benefits__icon">
                  <Icon size={36} />
                </span>
                <span>
                  <h3 className="mp-ld-benefits__title">{title}</h3>
                  <p className="mp-ld-benefits__body">{body}</p>
                </span>
              </li>
            ))}
          </ul>
          <p className="mp-ld-note">
            What a removed member already decrypted cannot be taken back — no
            password manager can. Mero Pass says so, and tells you which
            passwords to change.
          </p>
        </Chapter>

        {/* ── The Cloud band ───────────────────────────────────────────── */}
        <section className="mp-ld-band" aria-labelledby="cloud-title">
          <div className="mp-ld-grid">
            <div className="mp-ld-band__inner">
              <div>
                <p className="mp-ld-eyebrow">Calimero Cloud</p>
                <h2 id="cloud-title" className="mp-ld-title">
                  Always on. Still end-to-end.
                </h2>
                <p className="mp-ld-lede">
                  A Calimero Cloud node keeps your vaults synced when every
                  laptop on the team is closed. It stores exactly what your own
                  nodes store: ciphertext. It can hand out nothing it cannot
                  read.
                </p>
                <div className="mp-ld-actions">
                  <Ext href={LINKS.cloud} className="mp-ld-btn mp-ld-btn--dark">
                    Explore Calimero Cloud
                  </Ext>
                </div>
              </div>
              <ul className="mp-ld-band__list">
                <li>
                  <Cloud size={28} />
                  <span>Syncs while you sleep</span>
                </li>
                <li>
                  <CloudX size={28} />
                  <span>Never sees a plaintext value</span>
                </li>
                <li>
                  <ShieldCheck size={28} />
                  <span>Same roles, checked the same way</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── 05 Compare ───────────────────────────────────────────────── */}
        <Chapter n="05" label="Compared" id="compare">
          <h2 id="compare-title" className="mp-ld-title">
            The same job, a different owner.
          </h2>
          <div className="mp-ld-table-wrap">
            <table className="mp-ld-table">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col" className="is-us">
                    Mero Pass
                  </th>
                  <th scope="col">Cloud password managers</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([row, us, them]) => (
                  <tr key={row}>
                    <th scope="row">{row}</th>
                    <td className="is-us">{us}</td>
                    <td>{them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mp-ld-note">
            Honest about the gap: there is no browser extension yet, so no
            autofill. It is next.
          </p>
        </Chapter>

        {/* ── 06 FAQ ───────────────────────────────────────────────────── */}
        <Chapter n="06" label="Questions" id="faq" slim>
          <h2 id="faq-title" className="mp-ld-title">
            Asked before you trust it.
          </h2>
          <div className="mp-ld-faq">
            {FAQ.map(([q, a]) => (
              <details key={q} className="mp-ld-faq__item">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Chapter>

        {/* ── Closing ──────────────────────────────────────────────────── */}
        <section className="mp-ld-closing">
          <div className="mp-ld-grid">
            <div className="mp-ld-closing__inner">
              <h2 className="mp-ld-closing__title">
                Stop renting a vault.
                <span>Own it.</span>
              </h2>
              <p className="mp-ld-lede">
                Connect a node you already run, or get Calimero Desktop — it
                bundles one, so there is nothing to host.
              </p>
              <div className="mp-ld-actions mp-ld-actions--center">
                <button
                  type="button"
                  className="mp-ld-btn mp-ld-btn--primary"
                  onClick={connect}
                >
                  Connect to node
                </button>
                <Ext
                  href={LINKS.download}
                  className="mp-ld-btn mp-ld-btn--secondary"
                >
                  <Download size={16} /> Get Calimero Desktop
                </Ext>
                <Ext
                  href={LINKS.repo}
                  className="mp-ld-btn mp-ld-btn--secondary"
                >
                  Read the source
                </Ext>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="mp-ld-footer">
        <div className="mp-ld-footer__glow" aria-hidden="true" />
        <div className="mp-ld-grid">
          <div className="mp-ld-footer__top">
            <div className="mp-ld-footer__about">
              <Wordmark />
              <p>
                <span
                  className="mp-ld-footer__mark"
                  style={{ background: MARK_BG }}
                  aria-hidden="true"
                >
                  <BrandMark />
                </span>
                com.calimero.mero-pass
              </p>
              <p className="mp-ld-footer__tag">
                A peer-to-peer password manager, built on Calimero.
              </p>
            </div>
            <nav className="mp-ld-footer__cols" aria-label="Footer">
              <div>
                <p className="mp-ld-footer__head">Mero Pass</p>
                <Ext href={LINKS.repo}>Source</Ext>
                <Ext href={LINKS.security}>Security model</Ext>
                <Ext href={LINKS.registry}>App Registry</Ext>
              </div>
              <div>
                <p className="mp-ld-footer__head">Calimero</p>
                <Ext href={LINKS.site}>calimero.network</Ext>
                <Ext href={LINKS.cloud}>Cloud</Ext>
                <Ext href={LINKS.download}>Desktop</Ext>
              </div>
              <div>
                <p className="mp-ld-footer__head">Developers</p>
                <Ext href={LINKS.docs}>Documentation</Ext>
                <Ext href={LINKS.core}>Calimero core</Ext>
              </div>
              <div>
                <p className="mp-ld-footer__head">Community</p>
                <Ext href={LINKS.x}>X</Ext>
              </div>
            </nav>
          </div>
          <div className="mp-ld-footer__bottom">
            <span>© {new Date().getFullYear()} Calimero Network</span>
            <span className="mp-ld-footer__links">
              <span>Open source</span>
              <span className="mp-ld-dot" />
              <span>End-to-end encrypted</span>
              <span className="mp-ld-dot" />
              <a
                href="#top"
                onClick={(e) => {
                  e.preventDefault();
                  window.scrollTo({ top: 0 });
                }}
              >
                Back to top <ArrowRight size={12} />
              </a>
            </span>
          </div>
        </div>
      </footer>

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        theme={LOGIN_THEME}
        onConnect={(url: string) => {
          // Closed first: `connectToNode` navigates away to the node's sign-in,
          // and a modal still mounted over a page that is leaving flashes.
          setLoginOpen(false);
          connectToNode(url);
        }}
      />
    </div>
  );
}
