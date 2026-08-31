import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { ConnectButton, CalimeroLogo } from '@calimero-network/mero-react';
import { APP_DISPLAY_NAME, APP_DESCRIPTION } from '../../config';

/**
 * One-page marketing landing — the app's front door.
 *
 * White, professional Calimero aesthetic (neon green on paper + near-black),
 * mirroring Calimero Studio's landing. Scroll-reveal animations, an animated
 * live preview, a features grid and a FAQ about nodes / contexts / data.
 *
 * BUILD AGENT: customize the copy for the specific app — the headline, the
 * sub-headline, the three FEATURES, and the FAQ answers. Keep the structure,
 * the animations, the brand palette (C) and the auth wiring:
 *   - already authenticated (incl. desktop SSO skip) → go straight to the app
 *   - otherwise → animated landing + a ConnectButton CTA
 * Pull real product features from the spec; don't ship the placeholder copy.
 */

/* ── Calimero brand palette — neon green on white + near-black ─────────────── */
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
} as const;

/* ConnectButton + its login popup use the default mero-react theme — the
   default button (green #a5ff11 on dark text) already reads well on this white
   page, and the default popup keeps proper contrast (a dark modal). Overriding
   the theme broke the modal's internal contrast (white-on-green), so leave it. */

const FEATURES = [
  { icon: '🗂️', title: 'Shared board, live', body: 'Create and triage issues together — every status change, priority bump and new comment lands on your teammates’ boards in seconds.' },
  { icon: '🔒', title: 'Private to your team', body: 'The board lives in a decentralized context your team controls — no SaaS account, no third-party server watching your backlog.' },
  { icon: '💬', title: 'Discuss in context', body: 'Threaded comments on every issue with clear authorship — anyone can chime in, but you only edit or delete what you wrote.' },
];

const FAQS: [string, string][] = [
  ['How does the board work?', 'Create an issue with a summary, impact, repro and resolution criteria - it starts in Open and moves through In progress, Blocked and Done as your team works it. Every change syncs to all teammates within seconds.'],
  ['Where does our data live?', 'On your own Calimero node, as CRDT collections that merge conflict-free across peers. There is no central database — nothing about your issues is held on a third-party server.'],
  ['What is a context?', 'A context is a shared, encrypted space your team joins by invitation. Everyone in it sees the same board in real time, synced directly between nodes.'],
  ['How do teammates join?', 'Connect your node, then share an invite link. Anyone you invite joins the board and starts triaging instantly — no accounts, no sign-up.'],
  ['Who can edit comments?', 'Anyone on the team can comment on an issue, but only the author can edit or delete their own comments — authorship is enforced on the backend.'],
  ['Do we need crypto or a wallet?', 'No. You connect with a node identity. There is no token, no wallet and no gas — just your node and the teammates you invite.'],
];

/* ── scroll-reveal hook + wrapper (variants: up / zoom / drop / left) ──────── */
function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-visible');
          obs.disconnect();
        }
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
  v = 'up',
  d = 0,
  className,
  style,
  id,
  children,
}: {
  v?: RVariant;
  d?: number;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
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
  { k: '01', t: 'Connect your node', d: 'Point the app at the Calimero node you control. Your identity and keys stay on your machine.' },
  { k: '02', t: 'Open the board', d: 'Create or join your team’s shared context. Issues are CRDT data that merges across peers automatically.' },
  { k: '03', t: 'Invite your team', d: 'Share a code. Teammates join instantly and see the same board — no accounts, no setup.' },
  { k: '04', t: 'Triage together', d: 'Create, assign, prioritize and discuss issues live. Everything lives on your nodes — no central server.' },
];

/* ── animated live preview: an issue card moves across the board, loops ──── */
const COLUMNS = ['Open', 'In progress', 'Done'] as const;
type Prio = 'urgent' | 'high' | 'med';
type Card = { t: string; p?: Prio };
const BASE: Card[][] = [
  [{ t: 'Login button broken', p: 'high' }, { t: 'Flaky CI on main', p: 'med' }],
  [{ t: 'Dark-mode contrast', p: 'med' }],
  [{ t: 'Update onboarding docs' }],
];
const ACTIVE: Card = { t: 'Deploy pipeline fix', p: 'urgent' };

function LivePreview() {
  const [stage, setStage] = useState(0); // which column the active card sits in
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const loop = window.setInterval(() => {
      setStage((s) => (s + 1) % COLUMNS.length);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 420);
    }, 1900);
    return () => window.clearInterval(loop);
  }, []);

  return (
    <Preview aria-hidden="true">
      <div className="bar">
        <s style={{ background: '#ff5f56' }} />
        <s style={{ background: '#ffbd2e' }} />
        <s style={{ background: C.green }} />
        <span><CalimeroLogo size={13} color={C.green} /> {APP_DISPLAY_NAME.toLowerCase()} · your node</span>
        <em className={pulse ? 'on' : ''}>● {pulse ? 'syncing' : 'live'}</em>
      </div>
      <div className="board">
        {COLUMNS.map((col, ci) => {
          const cards = BASE[ci];
          const count = cards.length + (ci === stage ? 1 : 0);
          return (
            <div className="col" key={col}>
              <div className="colhead"><span>{col}</span><b>{count}</b></div>
              <div className="cards">
                {ci === stage && (
                  <div className="card active" key={stage}>
                    <span className={`dot ${ACTIVE.p}`} />
                    <p>{ACTIVE.t}</p>
                  </div>
                )}
                {cards.map((c) => (
                  <div className="card" key={c.t}>
                    {c.p && <span className={`dot ${c.p}`} />}
                    <p>{c.t}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Preview>
  );
}

/* ── FAQ row ───────────────────────────────────────────────────────────────── */
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

export default function LandingPage() {
  // Auth redirects (incl. desktop SSO skip) are handled by <RedirectIfAuthed>
  // in App.tsx, which waits for the async auth probe before navigating.

  // Real href keeps anchors keyboard-focusable; onClick upgrades to smooth scroll.
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Root>
      {/* ── header ─────────────────────────────────────────────── */}
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
          <a href="https://github.com/calimero-network" target="_blank" rel="noreferrer">GitHub ↗</a>
        </Nav>
        <div className="cta"><ConnectButton /></div>
      </Header>

      {/* ── hero ───────────────────────────────────────────────── */}
      <Hero>
        <Glow />
        <Grid />
        <HeroInner>
          <Eyebrow>
            <CalimeroLogo size={13} color={C.greenDeep} /> Powered by Calimero
          </Eyebrow>
          <H1>{APP_DISPLAY_NAME}</H1>
          <Lede>{APP_DESCRIPTION}</Lede>
          <Cta>
            <ConnectButton />
            <GhostBtn onClick={() => window.open('https://docs.calimero.network', '_blank', 'noopener,noreferrer')}>
              Learn more
            </GhostBtn>
          </Cta>
          <TrustRow>
            <span>Private by design</span><i />
            <span>Real-time sync</span><i />
            <span>Peer-to-peer</span>
          </TrustRow>
        </HeroInner>
        <PreviewWrap><LivePreview /></PreviewWrap>
      </Hero>

      {/* ── how it works ───────────────────────────────────────── */}
      <Section id="how" $alt>
        <Inner>
          <R v="up">
            <Kicker>How it works</Kicker>
            <H2>From your node to a shared app — in four moves</H2>
            <Sub>No accounts, no servers, no setup friction. Connect a node and you’re collaborating.</Sub>
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

      {/* ── features ───────────────────────────────────────────── */}
      <Section id="features">
        <Inner>
          <R v="up">
            <Kicker>Why it’s different</Kicker>
            <H2>Built on the Calimero network</H2>
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

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <Section id="faq" $alt>
        <Inner style={{ maxWidth: 760 }}>
          <R v="up">
            <Kicker>FAQ</Kicker>
            <H2>Nodes, contexts &amp; your data</H2>
          </R>
          <FaqList>
            {FAQS.map(([q, a], i) => (
              <R v="left" d={i * 0.06} key={q}><Faq q={q} a={a} /></R>
            ))}
          </FaqList>
        </Inner>
      </Section>

      {/* ── final CTA ──────────────────────────────────────────── */}
      <CtaBand>
        <R v="zoom">
          <h2>Connect your node to get started.</h2>
          <p>It takes seconds — your data never leaves your control.</p>
          <div className="btn"><ConnectButton /></div>
        </R>
      </CtaBand>

      {/* ── footer ─────────────────────────────────────────────── */}
      <Footer>
        <div className="top">
          <div className="brand">
            <span className="wm"><span className="mk"><CalimeroLogo size={20} color={C.green} /></span> {APP_DISPLAY_NAME}</span>
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
              <a href="https://github.com/calimero-network" target="_blank" rel="noreferrer">GitHub</a>
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
const cardIn = keyframes`from{opacity:0;transform:translateY(-8px) scale(0.96);}to{opacity:1;transform:none;}`;

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
  background: radial-gradient(1200px 480px at 75% -10%, #f3ffd9 0%, rgba(255, 255, 255, 0) 60%), ${C.paper};
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

/* live preview */
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
  box-shadow: 0 30px 70px -30px rgba(14, 20, 15, 0.5);
  overflow: hidden;
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
  .board { padding: 14px; min-height: 230px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .colhead { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid ${C.lineDark}; }
  .colhead span { font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: ${C.mutedSoft}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .colhead b { flex-shrink: 0; font-size: 10px; font-weight: 700; color: ${C.ink}; background: ${C.green}; border-radius: 999px; min-width: 17px; height: 16px; padding: 0 5px; display: grid; place-items: center; }
  .cards { display: flex; flex-direction: column; gap: 7px; }
  .card { display: flex; align-items: flex-start; gap: 6px; padding: 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid ${C.lineDark}; }
  .card p { font-size: 10.5px; line-height: 1.35; color: #dfe7db; }
  .card .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
  .card .dot.urgent { background: #ff5f56; }
  .card .dot.high { background: #ffbd2e; }
  .card .dot.med { background: ${C.mutedSoft}; }
  .card.active { background: ${C.green}; border-color: ${C.green}; box-shadow: 0 6px 18px rgba(164, 255, 17, 0.32); animation: ${cardIn} 0.42s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .card.active p { color: ${C.ink}; font-weight: 600; }
  .card.active .dot { box-shadow: 0 0 0 2px rgba(14, 20, 15, 0.15); }
  @media (prefers-reduced-motion: reduce) { .card.active { animation: none; } }
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
    p.$v === 'zoom'
      ? 'scale(0.9)'
      : p.$v === 'drop'
        ? 'translateY(-46px)'
        : p.$v === 'left'
          ? 'translateX(-44px)'
          : 'translateY(30px)'};
  transition:
    opacity 0.7s ${(p) => p.$d}s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.72s ${(p) => p.$d}s
      ${(p) => (p.$v === 'drop' ? 'cubic-bezier(0.2, 0.85, 0.3, 1.25)' : 'cubic-bezier(0.22, 1, 0.36, 1)')};
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
  .pulse { position: absolute; top: 14px; width: 12px; height: 12px; border-radius: 50%; background: ${C.green}; box-shadow: 0 0 0 5px rgba(164, 255, 17, 0.25); animation: ${travel} 4.2s ease-in-out infinite; }
  .stage { position: relative; text-align: left; }
  .dot { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; background: ${C.paper}; border: 1px solid ${C.line}; box-shadow: 0 6px 16px -8px rgba(14, 20, 15, 0.3); margin-bottom: 14px; }
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
  .ic { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: rgba(164, 255, 17, 0.14); font-size: 20px; margin-bottom: 14px; }
  h3 { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; color: ${C.ink}; margin-bottom: 7px; }
  p { font-size: 13.5px; color: ${C.muted}; }
  &:hover { transform: translateY(-3px); border-color: rgba(164, 255, 17, 0.6); box-shadow: 0 18px 40px -24px rgba(14, 20, 15, 0.4); }
`;

/* faq */
const FaqList = styled.div`margin-top: 34px; border-top: 1px solid ${C.line};`;
const FaqRow = styled.div<{ $open: boolean }>`
  border-bottom: 1px solid ${C.line};
  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 2px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.2px;
    color: ${C.ink};
    i { font-style: normal; flex-shrink: 0; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; font-size: 16px; color: ${C.greenInk}; background: rgba(164, 255, 17, 0.14); }
  }
  .ans { overflow: hidden; max-height: ${(p) => (p.$open ? '240px' : '0')}; transition: max-height 0.32s ease; }
  .ans p { padding: 0 2px 20px; font-size: 14px; color: ${C.muted}; max-width: 660px; }
`;

/* final CTA */
const CtaBand = styled.section`
  position: relative;
  overflow: hidden;
  text-align: center;
  padding: clamp(58px, 8vw, 92px) 24px;
  background: radial-gradient(700px 280px at 50% 120%, rgba(164, 255, 17, 0.22), transparent 70%), ${C.ink};
  border-top: 1px solid ${C.lineDark};
  h2 { font-size: clamp(24px, 3.6vw, 34px); font-weight: 700; letter-spacing: -0.8px; color: ${C.paper}; }
  p { margin: 12px 0 24px; font-size: 14.5px; color: ${C.mutedSoft}; }
  .btn { display: inline-flex; }
  &::after { content: ''; position: absolute; width: 360px; height: 360px; border-radius: 50%; left: -120px; bottom: -180px; background: radial-gradient(circle, rgba(164, 255, 17, 0.3), transparent 68%); filter: blur(24px); animation: ${drift} 12s ease-in-out infinite; }
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
