import { styled, keyframes } from "styled-components";

// ─── Brand ─────────────────────────────────────────────────────────────────────
// Primary: #A5FF11 (Calimero green)
// Dim green: rgba(165,255,17,...)

// ─── Animations ────────────────────────────────────────────────────────────────

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(22px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const float1 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  40%       { transform: translate(28px, -38px) scale(1.06); }
  70%       { transform: translate(-18px, 18px) scale(0.96); }
`;

const float2 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  35%       { transform: translate(-36px, 28px) scale(1.07); }
  70%       { transform: translate(22px, -18px) scale(0.94); }
`;

const float3 = keyframes`
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%       { transform: translate(18px, 32px) scale(1.05); }
`;

const shimmer = keyframes`
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%       { opacity: 1;    transform: scale(1.05); }
`;

const spin = keyframes`
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to   { transform: translate(-50%, -50%) rotate(360deg); }
`;

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
`;

const logoGlow = keyframes`
  0%, 100% { filter: drop-shadow(0 0 8px rgba(165,255,17,0.3)); }
  50%       { filter: drop-shadow(0 0 18px rgba(165,255,17,0.6)); }
`;

// ─── Layout ────────────────────────────────────────────────────────────────────

const Page = styled.div`
  position: relative;
  width: 100%;
  height: 100vh;
  background: #09090b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

// ─── Background ────────────────────────────────────────────────────────────────

const Orb = styled.div<{
  size: number; top: string; left: string;
  color: string; delay: number; anim: number;
}>`
  position: absolute;
  width: ${p => p.size}px;
  height: ${p => p.size}px;
  top: ${p => p.top};
  left: ${p => p.left};
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, ${p => p.color}, transparent 70%);
  filter: blur(${p => Math.round(p.size * 0.3)}px);
  opacity: 0.45;
  animation: ${p => p.anim === 1 ? float1 : p.anim === 2 ? float2 : float3}
    ${p => 16 + p.delay}s ease-in-out infinite;
  animation-delay: ${p => -p.delay * 2.5}s;
  pointer-events: none;
`;

const GridOverlay = styled.div`
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(165,255,17,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(165,255,17,0.04) 1px, transparent 1px);
  background-size: 64px 64px;
  pointer-events: none;
`;

const VignetteOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 35%, #09090b 82%);
  pointer-events: none;
`;

const Ring = styled.div<{ size: number; duration: number; reverse?: boolean }>`
  position: absolute;
  width: ${p => p.size}px;
  height: ${p => p.size}px;
  border-radius: 50%;
  border: 1px solid rgba(165,255,17,0.08);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: ${spin} ${p => p.duration}s linear infinite;
  animation-direction: ${p => p.reverse ? "reverse" : "normal"};

  &::before {
    content: "";
    position: absolute;
    width: 8px;
    height: 8px;
    background: rgba(165,255,17,0.7);
    border-radius: 50%;
    top: -4px;
    left: 50%;
    margin-left: -4px;
    filter: blur(2px);
    box-shadow: 0 0 8px rgba(165,255,17,0.5);
  }
`;

// ─── Content ───────────────────────────────────────────────────────────────────

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 660px;
  width: 90%;
  text-align: center;
`;

const LogoBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  background: rgba(165,255,17,0.06);
  border: 1px solid rgba(165,255,17,0.15);
  border-radius: 100px;
  padding: 8px 18px 8px 8px;
  margin-bottom: 2rem;
  animation: ${fadeUp} 0.6s ease both;
`;

const LogoImg = styled.img`
  width: 28px;
  height: 28px;
  object-fit: contain;
  animation: ${logoGlow} 3s ease-in-out infinite;
`;

const AppName = styled.span`
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(165,255,17,0.7);
`;

const Headline = styled.h1`
  font-size: clamp(2.2rem, 5vw, 3.5rem);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: #ffffff;
  margin: 0 0 1.25rem;
  animation: ${fadeUp} 0.6s 0.1s ease both;

  .green {
    background: linear-gradient(120deg, #a5ff11, #d4ff70, #a5ff11, #6be000);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ${shimmer} 5s linear infinite;
  }
`;

const Sub = styled.p`
  font-size: 1rem;
  color: rgba(255,255,255,0.42);
  line-height: 1.75;
  margin: 0 0 2.25rem;
  max-width: 440px;
  animation: ${fadeUp} 0.6s 0.2s ease both;
`;

const Features = styled.div`
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 2.25rem;
  animation: ${fadeUp} 0.6s 0.3s ease both;
`;

const Chip = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(165,255,17,0.05);
  border: 1px solid rgba(165,255,17,0.12);
  border-radius: 100px;
  padding: 7px 14px;
  font-size: 0.79rem;
  color: rgba(255,255,255,0.5);
  white-space: nowrap;
  transition: border-color 0.2s, color 0.2s;

  svg { flex-shrink: 0; opacity: 0.6; }

  &:hover {
    border-color: rgba(165,255,17,0.25);
    color: rgba(255,255,255,0.75);
  }
`;

const TerminalBox = styled.div`
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  padding: 13px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: ${fadeUp} 0.6s 0.4s ease both;
`;

const StatusDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a5ff11;
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(165,255,17,0.6);
  animation: ${pulse} 2.5s ease-in-out infinite;
`;

const TerminalText = styled.div`
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 0.77rem;
  color: rgba(255,255,255,0.3);

  .cmd { color: rgba(255,255,255,0.58); }

  .cursor {
    display: inline-block;
    width: 6px;
    height: 0.85em;
    background: rgba(165,255,17,0.75);
    margin-left: 3px;
    vertical-align: text-bottom;
    border-radius: 1px;
    animation: ${blink} 1.1s step-end infinite;
  }
`;

// ─── Component ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <Page>
      {/* Background layers */}
      <Orb size={460} top="-12%" left="-10%" color="rgba(100,220,10,0.55)"  delay={0} anim={1} />
      <Orb size={360} top="58%"  left="68%"  color="rgba(165,255,17,0.4)"   delay={4} anim={2} />
      <Orb size={260} top="62%"  left="2%"   color="rgba(80,180,10,0.35)"   delay={7} anim={3} />
      <Orb size={180} top="8%"   left="76%"  color="rgba(165,255,17,0.28)"  delay={2} anim={1} />
      <GridOverlay />
      <VignetteOverlay />
      <Ring size={580} duration={45} />
      <Ring size={800} duration={70} reverse />

      {/* Main content */}
      <Content>
        <LogoBadge>
          <LogoImg src="/curb.svg" alt="Calimero" />
          <AppName>Mero Chat</AppName>
        </LogoBadge>

        <Headline>
          Private messaging,<br />
          <span className="green">owned by you</span>
        </Headline>

        <Sub>
          Mero Chat is a decentralized chat app that runs on your own Calimero node.
          No servers. No surveillance. Your conversations stay yours.
        </Sub>

        <Features>
          <Chip>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            End-to-end encrypted
          </Chip>
          <Chip>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Self-hosted node
          </Chip>
          <Chip>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Invite-only access
          </Chip>
          <Chip>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Zero data collection
          </Chip>
        </Features>

        <TerminalBox>
          <StatusDot />
          <TerminalText>
            Open <span className="cmd">Calimero Desktop</span> and launch Mero Chat to get started
            <span className="cursor" />
          </TerminalText>
        </TerminalBox>
      </Content>
    </Page>
  );
}
