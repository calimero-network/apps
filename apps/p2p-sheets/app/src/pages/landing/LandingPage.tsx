import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { ConnectButton, CalimeroLogo } from '@calimero-network/mero-react';
import { APP_DISPLAY_NAME, APP_DESCRIPTION } from '../../config';

/**
 * Landing page for p2p-sheets — peer-to-peer collaborative spreadsheet.
 *
 * Customized sections:
 *  - Headline + sub-headline: spreadsheet product copy
 *  - LivePreview: mini spreadsheet animation (cells filling in + SUM formula)
 *  - FEATURES: three p2p-sheets specific features
 *  - FAQ: spreadsheet + Calimero questions
 */

/* ── Calimero brand palette (landing keeps its own hard-coded palette) ─────── */
const C = {
  green: '#A4FF11',
  greenHover: '#93e60c',
  greenDeep: '#4e7a06',
  greenInk: '#37610a',
  ink: '#0e140f',
  ink2: '#151c16',
  paper: '#ffffff',
  paper2: '#f5f8f1',
  line: '#e7ece2',
  lineDark: 'rgba(164,255,17,0.14)',
  muted: '#5d6b60',
  mutedSoft: '#93a394',
  accent: '#3B82F6',
} as const;

const FEATURES = [
  {
    icon: '🔒',
    title: 'Truly private spreadsheets',
    body: 'Your data never touches a central server. It lives in a Calimero context you control — only people you invite can see it.',
  },
  {
    icon: '⚡',
    title: 'Real-time collaborative editing',
    body: 'See every collaborator\'s cursor in their unique color. Changes to cells sync across all peers in under 2 seconds via CRDT merge.',
  },
  {
    icon: '🧮',
    title: 'Formulas that always compute',
    body: 'SUM, AVERAGE, MIN, MAX, COUNT, IF — formulas are stored raw and re-evaluated for all peers whenever a referenced cell changes.',
  },
];

const FAQS: [string, string][] = [
  [
    'How is this different from Google Sheets?',
    'Google Sheets stores your data on Google\'s servers. P2P Sheets stores every cell in a Calimero context that runs on your own node — only the people you explicitly invite ever see the data.',
  ],
  [
    'What happens if I go offline?',
    'Your node holds the full spreadsheet state. When you come back online your node re-syncs with peers and merges any changes that happened while you were offline using CRDT (conflict-free) merge.',
  ],
  [
    'Which formulas are supported?',
    'SUM, AVERAGE, MIN, MAX, COUNT, and IF are built-in. Each one is evaluated on the backend for every peer. The Function Reference panel inside the app shows syntax and examples.',
  ],
  [
    'How do I share a spreadsheet with someone?',
    'Click "Invite" in the toolbar to generate a short code. Share that code with your collaborator — they paste it into "Join with invitation" and appear in the workspace within seconds.',
  ],
  [
    'Can I download the spreadsheet?',
    'Yes. Click the Download button in the toolbar and you\'ll get a CSV file containing every sheet\'s data with sheet names as section headers.',
  ],
  [
    'Do I need a wallet or tokens?',
    'No. You connect with a node identity. There is no token, no wallet, and no gas — just your node and the collaborators you invite.',
  ],
];

/* ── Scroll-reveal hook ─────────────────────────────────────────────────────── */
function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { el.classList.add('is-visible'); obs.disconnect(); }
      },
      { threshold: 0.14 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

type RVariant = 'up' | 'zoom' | 'drop' | 'left';
function R({
  v = 'up', d = 0, className, style, id, children,
}: {
  v?: RVariant; d?: number; className?: string; style?: React.CSSProperties; id?: string;
  children: React.ReactNode;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <RBox ref={ref} $v={v} $d={d} className={className} style={style} id={id}>
      {children}
    </RBox>
  );
}

const STEPS = [
  { k: '01', t: 'Connect your node', d: 'Point the app at the Calimero node you control. Your identity and data keys stay on your machine.' },
  { k: '02', t: 'Create a spreadsheet', d: 'Bootstrap a new workspace. A default sheet is ready in seconds — all state is CRDT data on your node.' },
  { k: '03', t: 'Invite collaborators', d: 'Share a one-time invite code. Anyone you invite joins the context and sees the same cells in real time.' },
  { k: '04', t: 'Edit and formulas sync', d: 'Type values or formulas. SUM, AVERAGE, IF — results propagate to every peer automatically.' },
];

/* ── Animated live preview: mini spreadsheet filling in with data ───────────── */

interface AnimCell { col: number; row: number; value: string; formula?: boolean; author?: string; color?: string }

const SCRIPT_CELLS: AnimCell[] = [
  { col: 0, row: 0, value: '1 200', author: 'A', color: '#E74C3C' },
  { col: 0, row: 1, value: '3 400', author: 'M', color: '#3B82F6' },
  { col: 0, row: 2, value: '2 100', author: 'A', color: '#E74C3C' },
  { col: 1, row: 0, value: 'Wages',  author: 'M', color: '#3B82F6' },
  { col: 1, row: 1, value: 'Rent',   author: 'you', color: '#1A7F64' },
  { col: 1, row: 2, value: 'Misc',   author: 'you', color: '#1A7F64' },
  { col: 0, row: 3, value: '=SUM(A1:A3) → 6 700', formula: true, author: 'A', color: '#E74C3C' },
];

const COL_LABELS = ['A', 'B'];
const ROW_LABELS = ['1', '2', '3', '4'];

function LivePreview() {
  const [shown, setShown] = useState<AnimCell[]>([]);
  const [activeCursor, setActiveCursor] = useState<AnimCell | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const run = () => {
      setShown([]);
      setActiveCursor(null);
      SCRIPT_CELLS.forEach((cell, i) => {
        at(600 + i * 900, () => {
          setActiveCursor(cell);
          setPulse(true);
          at(600 + i * 900 + 500, () => {
            setShown((p) => [...p, cell]);
            setActiveCursor(null);
            setPulse(false);
          });
        });
      });
    };
    run();
    const total = SCRIPT_CELLS.length * 900 + 2000;
    const loop = window.setInterval(run, total);
    return () => { timers.forEach(window.clearTimeout); window.clearInterval(loop); };
  }, []);

  return (
    <Preview aria-hidden="true">
      {/* Window chrome */}
      <div className="bar">
        <s style={{ background: '#ff5f56' }} />
        <s style={{ background: '#ffbd2e' }} />
        <s style={{ background: C.green }} />
        <span>
          <CalimeroLogo size={12} color={C.green} /> {APP_DISPLAY_NAME.toLowerCase()} · your node
        </span>
        <em className={pulse ? 'on' : ''}>● {pulse ? 'syncing' : 'live'}</em>
      </div>

      {/* Peer avatars */}
      <div className="peers">
        <i style={{ background: '#E74C3C' }}>A</i>
        <i style={{ background: '#3B82F6' }}>M</i>
        <i style={{ background: '#1A7F64' }}>Y</i>
        <b>3 collaborators</b>
      </div>

      {/* Mini spreadsheet grid */}
      <div className="grid-wrap">
        <table className="sg">
          <thead>
            <tr>
              <th className="corner" />
              {COL_LABELS.map((l) => <th key={l} className="col-h">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROW_LABELS.map((rl, ri) => (
              <tr key={rl}>
                <td className="row-h">{rl}</td>
                {COL_LABELS.map((cl, ci) => {
                  const cell = shown.find((c) => c.col === ci && c.row === ri);
                  const isCursor =
                    activeCursor !== null &&
                    activeCursor.col === ci &&
                    activeCursor.row === ri;
                  return (
                    <td
                      key={cl}
                      className={`dc${cell ? ' has-val' : ''}${cell?.formula ? ' fm' : ''}`}
                      style={
                        isCursor
                          ? { outline: `2px solid ${activeCursor!.color}`, outlineOffset: '-2px' }
                          : cell
                            ? { borderTop: `2px solid ${cell.color}` }
                            : undefined
                      }
                    >
                      <div className="cv">{cell?.value ?? ''}</div>
                      {isCursor && (
                        <div
                          className="cur-tag"
                          style={{ background: activeCursor!.color }}
                        >
                          {activeCursor!.author}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="status">
        {shown.length > 0 && (
          <span className="stat-cell">
            {shown[shown.length - 1].formula ? '∑' : '✦'} {shown[shown.length - 1].value}
          </span>
        )}
        <span className="stat-sync">{shown.length}/{SCRIPT_CELLS.length} cells synced</span>
      </div>
    </Preview>
  );
}

/* ── FAQ row ─────────────────────────────────────────────────────────────────── */
function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <FaqRow $open={open}>
      <button onClick={() => setOpen((o) => !o)}>
        <span>{q}</span>
        <i aria-hidden="true">{open ? '−' : '+'}</i>
      </button>
      <div className="ans"><p>{a}</p></div>
    </FaqRow>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Root>
      {/* ── header ───────────────────────────────────── */}
      <Header>
        <Brand>
          <span className="mark"><CalimeroLogo size={24} color={C.greenInk} /></span>
          <span className="wm">{APP_DISPLAY_NAME}</span>
        </Brand>
        <Nav>
          <a href="#how" onClick={go('how')}>How it works</a>
          <a href="#features" onClick={go('features')}>Features</a>
          <a href="#faq" onClick={go('faq')}>FAQ</a>
          <a href="https://docs.calimero.network" target="_blank" rel="noreferrer">Docs ↗</a>
          <a href="https://github.com/calimero-network/apps/tree/main/apps/p2p-sheets" target="_blank" rel="noreferrer">GitHub ↗</a>
        </Nav>
        <div className="cta"><ConnectButton /></div>
      </Header>

      {/* ── hero ─────────────────────────────────────── */}
      <Hero>
        <Glow />
        <Grid />
        <HeroInner>
          <Eyebrow>
            <CalimeroLogo size={13} color={C.greenDeep} /> Powered by Calimero
          </Eyebrow>
          <H1>{APP_DISPLAY_NAME}</H1>
          <Lede>
            A collaborative spreadsheet that lives on your own node. Real-time cells,
            live cursors, and formula sync — no Google, no central server.
          </Lede>
          <Cta>
            <ConnectButton />
            <GhostBtn
              onClick={() =>
                window.open('https://docs.calimero.network', '_blank', 'noopener,noreferrer')
              }
            >
              Learn more
            </GhostBtn>
          </Cta>
          <TrustRow>
            <span>End-to-end private</span><i />
            <span>Real-time CRDT sync</span><i />
            <span>Formulas for all peers</span>
          </TrustRow>
        </HeroInner>
        <PreviewWrap><LivePreview /></PreviewWrap>
      </Hero>

      {/* ── how it works ─────────────────────────────── */}
      <Section id="how" $alt>
        <Inner>
          <R v="up">
            <Kicker>How it works</Kicker>
            <H2>From your node to a shared spreadsheet — in four moves</H2>
            <Sub>No accounts, no central database, no setup friction. Connect a node and start collaborating.</Sub>
          </R>
          <Pipeline>
            <span className="track" />
            <span className="pulse" />
            {STEPS.map((s, i) => (
              <R v="drop" d={0.12 + i * 0.12} key={s.k}>
                <div className="stage">
                  <div className="dot"><b>{s.k}</b></div>
                  <h4>{s.t}</h4>
                  <p>{s.d}</p>
                </div>
              </R>
            ))}
          </Pipeline>
        </Inner>
      </Section>

      {/* ── features ─────────────────────────────────── */}
      <Section id="features">
        <Inner>
          <R v="up">
            <Kicker>Why it&rsquo;s different</Kicker>
            <H2>Spreadsheets the way they should be — private and live</H2>
          </R>
          <Cards>
            {FEATURES.map((f, i) => (
              <R v="drop" d={i * 0.12} key={f.title}>
                <Card>
                  <span className="ic">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Card>
              </R>
            ))}
          </Cards>
        </Inner>
      </Section>

      {/* ── FAQ ──────────────────────────────────────── */}
      <Section id="faq" $alt>
        <Inner style={{ maxWidth: 760 }}>
          <R v="up">
            <Kicker>FAQ</Kicker>
            <H2>Spreadsheets, nodes &amp; your data</H2>
          </R>
          <FaqList>
            {FAQS.map(([q, a], i) => (
              <R v="left" d={i * 0.06} key={q}><Faq q={q} a={a} /></R>
            ))}
          </FaqList>
        </Inner>
      </Section>

      {/* ── final CTA ────────────────────────────────── */}
      <CtaBand>
        <R v="zoom">
          <h2>Start your private spreadsheet today.</h2>
          <p>Connect your node — your data stays on your machine, forever.</p>
          <div className="btn"><ConnectButton /></div>
        </R>
      </CtaBand>

      {/* ── footer ───────────────────────────────────── */}
      <Footer>
        <div className="top">
          <div className="brand">
            <span className="wm">
              <span className="mk"><CalimeroLogo size={20} color={C.green} /></span> {APP_DISPLAY_NAME}
            </span>
            <p>Private. Real-time. Yours.</p>
          </div>
          <div className="cols">
            <div>
              <h5>App</h5>
              <a href="#how" onClick={go('how')}>How it works</a>
              <a href="#features" onClick={go('features')}>Features</a>
              <a href="#faq" onClick={go('faq')}>FAQ</a>
            </div>
            <div>
              <h5>Calimero</h5>
              <a href="https://calimero.network" target="_blank" rel="noreferrer">Website</a>
              <a href="https://docs.calimero.network" target="_blank" rel="noreferrer">Docs</a>
              <a href="https://github.com/calimero-network/core" target="_blank" rel="noreferrer">Core node</a>
            </div>
            <div>
              <h5>Community</h5>
              <a href="https://github.com/calimero-network/apps/tree/main/apps/p2p-sheets" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://x.com/CalimeroNetwork" target="_blank" rel="noreferrer">X / Twitter</a>
              <a href="https://discord.gg/calimero" target="_blank" rel="noreferrer">Discord</a>
            </div>
          </div>
        </div>
        <div className="bottom">
          <span>Built on Calimero</span>
          <span>Self-sovereign by design</span>
        </div>
      </Footer>
    </Root>
  );
}

/* ════════════════════════ keyframes ════════════════════════ */
const float = keyframes`0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(14px,-18px) scale(1.05);}`;
const drift = keyframes`0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-22px,14px) scale(1.07);}`;
const travel = keyframes`0%{left:0;opacity:0;}8%{opacity:1;}92%{opacity:1;}100%{left:100%;opacity:0;}`;
const cellIn = keyframes`from{opacity:0;transform:scale(0.92);}to{opacity:1;transform:none;}`;
const cursorBlink = keyframes`0%,100%{opacity:1;}50%{opacity:0.5;}`;

/* ════════════════════════ layout ════════════════════════ */
const Root = styled.div`
  position: fixed;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${C.paper};
  color: ${C.ink};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
`;

const Header = styled.header`
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px clamp(18px, 5vw, 56px);
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: saturate(160%) blur(14px);
  border-bottom: 1px solid ${C.line};
  .cta { margin-left: auto; }
`;
const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  .mark { display: flex; }
  .wm { font-size: 15px; letter-spacing: -0.3px; color: ${C.ink}; font-weight: 700; }
`;
const Nav = styled.nav`
  display: flex;
  gap: 26px;
  margin-left: auto;
  a {
    font-size: 13px;
    font-weight: 500;
    color: ${C.muted};
    cursor: pointer;
    text-decoration: none;
    transition: color 0.18s;
    &:hover { color: ${C.ink}; }
  }
  & + .cta { margin-left: 0; }
  @media (max-width: 880px) { display: none; }
`;

/* hero */
const Hero = styled.section`
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
  padding: clamp(56px, 8vw, 104px) clamp(18px, 5vw, 56px) clamp(64px, 9vw, 110px);
  background: radial-gradient(1200px 480px at 75% -10%, #f3ffd9 0%, rgba(255,255,255,0) 60%), ${C.paper};
  @media (max-width: 940px) { grid-template-columns: 1fr; }
  @media (max-width: 560px) { padding: 40px 18px 56px; gap: 30px; }
`;
const Glow = styled.div`
  position: absolute;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  top: -140px;
  right: -80px;
  background: radial-gradient(circle, rgba(164, 255, 17, 0.5), rgba(164, 255, 17, 0) 68%);
  filter: blur(26px);
  animation: ${float} 11s ease-in-out infinite;
  pointer-events: none;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Grid = styled.div`
  position: absolute;
  inset: 0;
  background-image: linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(680px 380px at 30% 30%, #000 0%, transparent 75%);
  opacity: 0.5;
  pointer-events: none;
`;
const HeroInner = styled.div`
  position: relative;
  z-index: 1;
  max-width: 580px;
`;
const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${C.greenDeep};
  background: rgba(164, 255, 17, 0.13);
  border: 1px solid rgba(164, 255, 17, 0.4);
  padding: 5px 11px;
  border-radius: 999px;
`;
const H1 = styled.h1`
  margin: 20px 0 16px;
  font-size: clamp(36px, 6vw, 58px);
  line-height: 1.03;
  letter-spacing: -1.6px;
  font-weight: 800;
  color: ${C.ink};
`;
const Lede = styled.p`
  font-size: 16px;
  color: ${C.muted};
  max-width: 500px;
  margin-bottom: 26px;
`;
const Cta = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;
const GhostBtn = styled.button`
  padding: 11px 18px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.line};
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  &:hover { background: ${C.paper2}; border-color: ${C.lineDark}; transform: translateY(-1px); }
`;
const TrustRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 30px;
  span { font-size: 12px; font-weight: 500; color: ${C.muted}; }
  i { width: 4px; height: 4px; border-radius: 50%; background: ${C.green}; }
`;

/* live preview — mini spreadsheet */
const PreviewWrap = styled.div`
  position: relative;
  z-index: 1;
  animation: ${float} 9s ease-in-out infinite;
  @media (max-width: 940px) { animation: none; }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Preview = styled.div`
  border: 1px solid ${C.line};
  border-radius: 14px;
  background: ${C.ink};
  box-shadow: 0 30px 70px -30px rgba(14,20,15,0.5);
  overflow: hidden;
  min-width: 340px;

  .bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 14px;
    border-bottom: 1px solid ${C.lineDark};
    background: ${C.ink2};
    s { width: 10px; height: 10px; border-radius: 50%; }
    span {
      margin-left: 8px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 11.5px;
      color: ${C.mutedSoft};
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    }
    em {
      margin-left: auto;
      font-style: normal;
      font-size: 10.5px;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      color: ${C.mutedSoft};
      transition: color 0.3s;
    }
    em.on { color: ${C.green}; }
  }

  .peers {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 8px 14px;
    border-bottom: 1px solid ${C.lineDark};
  }
  .peers i {
    width: 20px; height: 20px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 9px; font-weight: 700; color: #fff;
    border: 1.5px solid ${C.ink};
    margin-left: -5px;
    flex-shrink: 0;
  }
  .peers i:first-child { margin-left: 0; }
  .peers b {
    margin-left: 10px;
    font-size: 11px; font-weight: 500; color: ${C.mutedSoft};
  }

  /* grid */
  .grid-wrap {
    padding: 10px 14px 8px;
    overflow: hidden;
  }
  .sg {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
  }
  .sg th, .sg td {
    height: 26px;
    font-size: 11px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
  .corner { width: 28px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); }
  .col-h {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    color: ${C.mutedSoft};
    text-align: center;
    font-size: 11px;
    font-weight: 600;
  }
  .row-h {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    color: ${C.mutedSoft};
    text-align: center;
    font-size: 11px;
    font-weight: 500;
    width: 28px;
  }
  .dc {
    border: 1px solid rgba(255,255,255,0.08);
    padding: 0 6px;
    color: #8ba87a;
    position: relative;
    transition: border-color 0.2s;
    background: transparent;
    text-align: right;
  }
  .dc.has-val {
    color: #dfe7db;
    animation: ${cellIn} 0.28s cubic-bezier(0.22,1,0.36,1) both;
  }
  .dc.fm {
    color: ${C.green};
    font-weight: 600;
  }
  .cv {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cur-tag {
    position: absolute;
    top: -1px; right: -1px;
    font-size: 8px;
    font-weight: 700;
    color: #fff;
    padding: 1px 3px;
    border-radius: 0 0 0 3px;
    line-height: 1.4;
    text-transform: uppercase;
    animation: ${cursorBlink} 1.2s ease-in-out infinite;
  }

  /* status bar */
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 14px;
    border-top: 1px solid ${C.lineDark};
    font-size: 10.5px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }
  .stat-cell { color: ${C.green}; font-weight: 600; }
  .stat-sync { color: ${C.mutedSoft}; }
`;

/* sections */
const Section = styled.section<{ $alt?: boolean }>`
  padding: clamp(58px, 8vw, 104px) clamp(18px, 5vw, 56px);
  background: ${(p) => (p.$alt ? C.paper2 : C.paper)};
  border-top: 1px solid ${C.line};
  scroll-margin-top: 76px;
  @media (max-width: 560px) { padding: 46px 18px; }
`;
const Inner = styled.div`max-width: 1040px; margin: 0 auto;`;

const RBox = styled.div<{ $v: RVariant; $d: number }>`
  opacity: 0;
  will-change: opacity, transform;
  transform: ${(p) =>
    p.$v === 'zoom' ? 'scale(0.9)'
      : p.$v === 'drop' ? 'translateY(-46px)'
        : p.$v === 'left' ? 'translateX(-44px)'
          : 'translateY(30px)'};
  transition:
    opacity 0.7s ${(p) => p.$d}s cubic-bezier(0.22,1,0.36,1),
    transform 0.72s ${(p) => p.$d}s
      ${(p) => (p.$v === 'drop' ? 'cubic-bezier(0.2,0.85,0.3,1.25)' : 'cubic-bezier(0.22,1,0.36,1)')};
  &.is-visible { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { opacity: 1; transform: none; transition: none; }
`;

const Kicker = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${C.greenDeep};
  margin-bottom: 12px;
`;
const H2 = styled.h2`
  font-size: clamp(24px, 3.4vw, 33px);
  line-height: 1.12;
  letter-spacing: -0.9px;
  font-weight: 700;
  color: ${C.ink};
  max-width: 720px;
`;
const Sub = styled.p`margin-top: 13px; font-size: 14.5px; color: ${C.muted}; max-width: 600px;`;

/* pipeline */
const Pipeline = styled.div`
  position: relative;
  margin-top: 52px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px;
  .track { position: absolute; top: 19px; left: 6%; right: 6%; height: 2px; background: linear-gradient(90deg, ${C.line}, #cfe6a6, ${C.line}); }
  .pulse { position: absolute; top: 14px; width: 12px; height: 12px; border-radius: 50%; background: ${C.green}; box-shadow: 0 0 0 5px rgba(164,255,17,0.25); animation: ${travel} 4.2s ease-in-out infinite; }
  .stage { position: relative; text-align: left; }
  .dot { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; background: ${C.paper}; border: 1px solid ${C.line}; box-shadow: 0 6px 16px -8px rgba(14,20,15,0.3); margin-bottom: 14px; }
  .dot b { font-size: 13px; font-weight: 700; color: ${C.greenDeep}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  .stage h4 { font-size: 15px; font-weight: 700; color: ${C.ink}; margin-bottom: 6px; letter-spacing: -0.2px; }
  .stage p { font-size: 13px; color: ${C.muted}; }
  @media (max-width: 760px) {
    grid-template-columns: 1fr 1fr;
    .track, .pulse { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
`;

/* feature cards */
const Cards = styled.div`
  margin-top: 40px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  @media (max-width: 820px) { grid-template-columns: 1fr; }
`;
const Card = styled.div`
  padding: 24px 22px;
  border: 1px solid ${C.line};
  border-radius: 14px;
  background: ${C.paper};
  height: 100%;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
  .ic { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: rgba(164,255,17,0.14); font-size: 20px; margin-bottom: 14px; }
  h3 { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; color: ${C.ink}; margin-bottom: 7px; }
  p { font-size: 13.5px; color: ${C.muted}; }
  &:hover { transform: translateY(-3px); border-color: rgba(164,255,17,0.6); box-shadow: 0 18px 40px -24px rgba(14,20,15,0.4); }
`;

/* faq */
const FaqList = styled.div`margin-top: 34px; border-top: 1px solid ${C.line};`;
const FaqRow = styled.div<{ $open: boolean }>`
  border-bottom: 1px solid ${C.line};
  button {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 18px 2px; background: none; border: none; cursor: pointer; text-align: left;
    font-size: 15px; font-weight: 600; letter-spacing: -0.2px; color: ${C.ink};
    i { font-style: normal; flex-shrink: 0; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; font-size: 16px; color: ${C.greenInk}; background: rgba(164,255,17,0.14); }
  }
  .ans { overflow: hidden; max-height: ${(p) => (p.$open ? '260px' : '0')}; transition: max-height 0.32s ease; }
  .ans p { padding: 0 2px 20px; font-size: 14px; color: ${C.muted}; max-width: 660px; }
`;

/* final CTA */
const CtaBand = styled.section`
  position: relative;
  overflow: hidden;
  text-align: center;
  padding: clamp(58px, 8vw, 92px) 24px;
  background: radial-gradient(700px 280px at 50% 120%, rgba(164,255,17,0.22), transparent 70%), ${C.ink};
  border-top: 1px solid ${C.lineDark};
  h2 { font-size: clamp(24px, 3.6vw, 34px); font-weight: 700; letter-spacing: -0.8px; color: ${C.paper}; }
  p { margin: 12px 0 24px; font-size: 14.5px; color: ${C.mutedSoft}; }
  .btn { display: inline-flex; }
  &::after { content: ''; position: absolute; width: 360px; height: 360px; border-radius: 50%; left: -120px; bottom: -180px; background: radial-gradient(circle, rgba(164,255,17,0.3), transparent 68%); filter: blur(24px); animation: ${drift} 12s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { &::after { animation: none; } }
`;

/* footer */
const Footer = styled.footer`
  background: ${C.ink};
  color: ${C.mutedSoft};
  padding: 54px clamp(18px, 5vw, 56px) 30px;
  .top { max-width: 1040px; margin: 0 auto; display: grid; grid-template-columns: 1.3fr 2fr; gap: 40px; }
  @media (max-width: 760px) { .top { grid-template-columns: 1fr; gap: 28px; } }
  .brand .wm { display: inline-flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 700; color: ${C.paper}; }
  .brand .mk { display: flex; }
  .brand p { margin-top: 10px; font-size: 13px; max-width: 280px; }
  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  @media (max-width: 560px) { .cols { grid-template-columns: 1fr 1fr; gap: 20px 24px; } }
  .cols h5 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: ${C.paper}; margin-bottom: 12px; }
  .cols a { display: block; font-size: 13px; color: ${C.mutedSoft}; text-decoration: none; margin-bottom: 9px; cursor: pointer; transition: color 0.16s; &:hover { color: ${C.green}; } }
  .bottom { max-width: 1040px; margin: 36px auto 0; padding-top: 20px; border-top: 1px solid ${C.lineDark}; display: flex; justify-content: space-between; gap: 12px; font-size: 12px; flex-wrap: wrap; }
`;
