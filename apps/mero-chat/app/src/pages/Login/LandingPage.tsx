import React, { useState, useEffect } from "react";
import { styled, keyframes, css } from "styled-components";

// ─── Brand: #A5FF11 (Calimero green) ────────────────────────────────────────

// ─── Animations ─────────────────────────────────────────────────────────────

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

const msgAppear = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const channelSlide = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
`;

const dotBounce = keyframes`
  0%, 80%, 100% { transform: translateY(0);   opacity: 0.4; }
  40%           { transform: translateY(-4px); opacity: 1; }
`;

const reactionPop = keyframes`
  0%   { transform: scale(0); opacity: 0; }
  60%  { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1);   opacity: 1; }
`;

const frameGlow = keyframes`
  0%, 100% { box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px rgba(0,0,0,0.55), 0 0 40px rgba(165,255,17,0.03); }
  50%       { box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px rgba(0,0,0,0.55), 0 0 60px rgba(165,255,17,0.07); }
`;

const toastSlide = keyframes`
  from { opacity: 0; transform: translateX(20px) scale(0.96); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
`;

const dmSlide = keyframes`
  from { opacity: 0; transform: translateX(-5px); }
  to   { opacity: 1; transform: translateX(0); }
`;

// Section-specific animations
const packetTravel = keyframes`
  0%   { left: -10px; opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { left: calc(100% + 10px); opacity: 0; }
`;

const nodeGlow = keyframes`
  0%, 100% { box-shadow: 0 0 0 1px rgba(165,255,17,0.2), 0 4px 14px rgba(0,0,0,0.4); }
  50%       { box-shadow: 0 0 0 1px rgba(165,255,17,0.5), 0 4px 14px rgba(0,0,0,0.4), 0 0 22px rgba(165,255,17,0.14); }
`;

const _sectFadeUp = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to   { opacity: 1; transform: translateY(0); }
`;

// ─── Page shell ──────────────────────────────────────────────────────────────

const LandingRoot = styled.div`
  width: 100%;
  background: #09090b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow-x: hidden;
`;

// Used when children prop is provided (post-auth background wrapper)
const BackgroundPage = styled.div`
  position: relative;
  width: 100%;
  min-height: 100vh;
  background: #09090b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

// Hero section (full viewport)
const HeroSection = styled.div`
  position: relative;
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  @media (max-width: 1099px) {
    padding-top: 12px;
  }

  @media (min-width: 1100px) {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 5rem;
    padding: 2rem 5vw;
  }
`;

// ─── Background ──────────────────────────────────────────────────────────────

const Orb = styled.div<{
  $size: number; $top: string; $left: string;
  $color: string; $delay: number; $anim: number;
}>`
  position: absolute;
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  top: ${p => p.$top};
  left: ${p => p.$left};
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, ${p => p.$color}, transparent 70%);
  filter: blur(${p => Math.round(p.$size * 0.3)}px);
  opacity: 0.45;
  ${p => css`
    animation: ${p.$anim === 1 ? float1 : p.$anim === 2 ? float2 : float3} ${16 + p.$delay}s ease-in-out infinite;
    animation-delay: ${-p.$delay * 2.5}s;
  `}
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

const Ring = styled.div<{ $size: number; $duration: number; $reverse?: boolean }>`
  position: absolute;
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  border-radius: 50%;
  border: 1px solid rgba(165,255,17,0.08);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  ${p => css`
    animation: ${spin} ${p.$duration}s linear infinite;
    animation-direction: ${p.$reverse ? "reverse" : "normal"};
  `}

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

// ─── Hero Content ─────────────────────────────────────────────────────────────

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 540px;
  width: 90%;
  text-align: center;

  @media (min-width: 1100px) {
    align-items: flex-start;
    text-align: left;
    flex-shrink: 0;
    width: 460px;
  }
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

  @media (min-width: 1100px) {
    justify-content: flex-start;
  }
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

const ConnectButtonWrapper = styled.div`
  margin-top: 1.5rem;
  animation: ${fadeUp} 0.6s 0.5s ease both;
`;

// ─── Preview Section ──────────────────────────────────────────────────────────

const PreviewSection = styled.div`
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: ${fadeUp} 0.9s 0.15s ease both;
  margin-top: 3rem;

  @media (min-width: 1100px) {
    margin-top: 0;
  }
`;

/* Clips to the scaled visual size so no extra whitespace remains */
const PreviewScaleWrap = styled.div`
  @media (max-width: 479px) {
    width: 294px;
    height: 347px;
    position: relative;
    overflow: hidden;
  }

  @media (min-width: 480px) and (max-width: 1099px) {
    width: 357px;
    height: 422px;
    position: relative;
    overflow: hidden;
  }
`;

const PreviewScaleInner = styled.div`
  @media (max-width: 479px) {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    transform: scale(0.7);
  }

  @media (min-width: 480px) and (max-width: 1099px) {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    transform: scale(0.85);
  }
`;

const PreviewCaption = styled.div`
  margin-top: 12px;
  font-size: 0.67rem;
  color: rgba(255,255,255,0.18);
  letter-spacing: 0.06em;
  text-align: center;
`;

// ─── Browser Frame ────────────────────────────────────────────────────────────

const BrowserFrame = styled.div<{ $fading: boolean }>`
  position: relative;
  width: 420px;
  height: 496px;
  background: #111113;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.09);
  overflow: hidden;
  animation: ${frameGlow} 6s ease-in-out infinite;
  transition: opacity 0.5s ease;
  opacity: ${p => p.$fading ? 0 : 1};
`;

const FrameBar = styled.div`
  height: 38px;
  background: #191919;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
  flex-shrink: 0;
`;

const TL = styled.div<{ color: string }>`
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: ${p => p.color};
  opacity: 0.75;
`;

const FrameURL = styled.div`
  flex: 1;
  background: rgba(255,255,255,0.04);
  border-radius: 5px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.64rem;
  color: rgba(255,255,255,0.22);
  margin: 0 8px;
  letter-spacing: 0.02em;
`;

const AppLayout = styled.div`
  display: flex;
  height: calc(100% - 38px);
`;

const Sidebar = styled.div`
  width: 128px;
  background: #0d0d0f;
  border-right: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
`;

const WorkspaceName = styled.div`
  padding: 11px 12px 9px;
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(255,255,255,0.7);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SideSection = styled.div`
  padding: 8px 0 2px;
`;

const SideSectionLabel = styled.div`
  padding: 2px 12px 4px;
  font-size: 0.58rem;
  font-weight: 600;
  color: rgba(255,255,255,0.22);
  letter-spacing: 0.09em;
  text-transform: uppercase;
`;

const ChannelRow = styled.div<{ $active: boolean; $shown: boolean }>`
  padding: 4px 12px 4px 10px;
  font-size: 0.7rem;
  color: ${p => p.$active ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.38)"};
  background: ${p => p.$active ? "rgba(165,255,17,0.07)" : "transparent"};
  border-left: 2px solid ${p => p.$active ? "rgba(165,255,17,0.45)" : "transparent"};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  opacity: ${p => p.$shown ? 1 : 0};
  animation: ${p => p.$shown ? css`${channelSlide} 0.28s ease both` : "none"};

  span.hash { opacity: 0.38; margin-right: 2px; }
`;

const UnreadBadge = styled.div`
  background: rgba(165,255,17,0.18);
  color: rgba(165,255,17,0.8);
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  line-height: 1.4;
`;

const ChatArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #111113;
  min-width: 0;
`;

const ChatHeader = styled.div`
  height: 38px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
  flex-shrink: 0;

  span.hash { opacity: 0.38; font-size: 0.78rem; }
  span.name { font-size: 0.76rem; font-weight: 600; color: rgba(255,255,255,0.78); }
`;

const MessagesArea = styled.div`
  flex: 1;
  padding: 8px 10px 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
`;

const Msg = styled.div<{ $shown: boolean }>`
  display: flex;
  gap: 7px;
  align-items: flex-start;
  padding: 3px 0;
  opacity: ${p => p.$shown ? 1 : 0};
  animation: ${p => p.$shown ? css`${msgAppear} 0.28s ease both` : "none"};
`;

const Av = styled.div<{ $bg: string }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${p => p.$bg};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.58rem;
  font-weight: 700;
  color: #09090b;
  flex-shrink: 0;
  margin-top: 1px;
`;

const MsgBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const MsgMeta = styled.div`
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin-bottom: 1px;
`;

const MsgUser = styled.span<{ color: string }>`
  font-size: 0.68rem;
  font-weight: 600;
  color: ${p => p.color};
`;

const MsgTime = styled.span`
  font-size: 0.58rem;
  color: rgba(255,255,255,0.18);
`;

const MsgText = styled.div`
  font-size: 0.7rem;
  color: rgba(255,255,255,0.6);
  line-height: 1.45;
  word-break: break-word;
`;

const Reaction = styled.div<{ $shown: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 3px;
  background: rgba(165,255,17,0.07);
  border: 1px solid rgba(165,255,17,0.16);
  border-radius: 20px;
  padding: 2px 6px;
  font-size: 0.62rem;
  color: rgba(255,255,255,0.48);
  cursor: pointer;
  opacity: ${p => p.$shown ? 1 : 0};
  animation: ${p => p.$shown ? css`${reactionPop} 0.28s ease both` : "none"};
`;

const TypingRow = styled.div<{ $shown: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  opacity: ${p => p.$shown ? 1 : 0};
  transition: opacity 0.18s ease;
`;

const Dots = styled.div`
  display: flex;
  gap: 3px;
  align-items: center;
`;

const Dot = styled.span<{ d: number }>`
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
  ${p => css`
    animation: ${dotBounce} 1.1s ease-in-out ${p.d}ms infinite;
  `}
`;

const TypingLabel = styled.span`
  font-size: 0.6rem;
  color: rgba(255,255,255,0.22);
  font-style: italic;
`;

const InputRow = styled.div`
  padding: 7px 10px;
  border-top: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
`;

const InputMock = styled.div`
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 7px;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 0.64rem;
  color: rgba(255,255,255,0.18);
`;

const DmRow = styled.div<{ $shown: boolean }>`
  padding: 4px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: ${p => p.$shown ? 1 : 0};
  animation: ${p => p.$shown ? css`${dmSlide} 0.26s ease both` : "none"};
`;

const DmAvatar = styled.div<{ $bg: string }>`
  position: relative;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: ${p => p.$bg};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.52rem;
  font-weight: 700;
  color: #09090b;
  flex-shrink: 0;
`;

const OnlineDot = styled.div<{ $online: boolean }>`
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${p => p.$online ? "#a5ff11" : "rgba(255,255,255,0.18)"};
  border: 1px solid #0d0d0f;
`;

const DmName = styled.div`
  font-size: 0.66rem;
  color: rgba(255,255,255,0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ToastOverlay = styled.div`
  position: absolute;
  top: 46px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  z-index: 10;
  pointer-events: none;
`;

const ToastItem = styled.div<{ $shown: boolean }>`
  background: rgba(22, 22, 28, 0.95);
  border: 1px solid rgba(165,255,17,0.22);
  border-radius: 8px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 160px;
  opacity: ${p => p.$shown ? 1 : 0};
  transition: opacity 0.25s ease;
  animation: ${p => p.$shown ? css`${toastSlide} 0.3s ease both` : "none"};
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
`;

const ToastIconEl = styled.div`
  font-size: 0.72rem;
  flex-shrink: 0;
`;

const ToastText = styled.div`
  font-size: 0.6rem;
  color: rgba(255,255,255,0.7);
  line-height: 1.35;
`;

// ─── Chat Preview data & component ───────────────────────────────────────────

const CHANNELS = [
  { name: "general", unread: 0 },
  { name: "dev",     unread: 3 },
  { name: "design",  unread: 0 },
];

const DMS = [
  { name: "Alice",   init: "A", color: "#a5ff11", online: true  },
  { name: "Bob",     init: "B", color: "#60a5fa", online: true  },
  { name: "Charlie", init: "C", color: "#f472b6", online: false },
];

const MSGS = [
  { user: "Alice",   init: "A", color: "#a5ff11", text: "Just deployed to production! 🚀",   time: "2:41 PM" },
  { user: "Bob",     init: "B", color: "#60a5fa", text: "Sync complete across all nodes ✓",  time: "2:42 PM" },
  { user: "Charlie", init: "C", color: "#f472b6", text: "CRDT merge — no conflicts! 💪",     time: "2:43 PM" },
  { user: "Alice",   init: "A", color: "#a5ff11", text: "P2P is the future 👋",              time: "2:44 PM" },
] as const;

const STEP_DELAYS = [350, 280, 280, 560, 320, 320, 700, 820, 850, 680, 580, 850, 1050, 1350, 820, 2400];

function ChatPreview() {
  const [step, setStep] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (step < STEP_DELAYS.length) {
      const t = setTimeout(() => setStep(s => s + 1), STEP_DELAYS[step]);
      return () => clearTimeout(t);
    }
    setFading(true);
    const t = setTimeout(() => { setStep(0); setFading(false); }, 700);
    return () => clearTimeout(t);
  }, [step]);

  const shownChannels = Math.min(step, 3);
  const showDmSection  = step >= 4;
  const shownDms       = step >= 4 ? Math.min(step - 4, 3) : 0;
  const msgShown       = [step >= 7, step >= 9, step >= 12, step >= 15];
  const showTyping     = step === 8 || step === 11 || step === 14;
  const showReaction   = step >= 10 && step < STEP_DELAYS.length;
  const typingWho      = step === 8 ? "Bob" : step === 11 ? "Charlie" : "Alice";
  const showInviteToast   = step === 13;
  const showChannelToast  = step === 14 || step === 15;

  return (
    <BrowserFrame $fading={fading}>
      <FrameBar>
        <TL color="#ff5f56" />
        <TL color="#ffbd2e" />
        <TL color="#27c93f" />
        <FrameURL>mero-chat · calimero node</FrameURL>
      </FrameBar>
      <AppLayout>
        <Sidebar>
          <WorkspaceName>My Team</WorkspaceName>
          <SideSection>
            <SideSectionLabel>Channels</SideSectionLabel>
            {CHANNELS.map((ch, i) => (
              <ChannelRow key={ch.name} $active={i === 0} $shown={shownChannels > i}>
                <span><span className="hash">#</span>{ch.name}</span>
                {ch.unread > 0 && <UnreadBadge>{ch.unread}</UnreadBadge>}
              </ChannelRow>
            ))}
          </SideSection>
          {showDmSection && (
            <SideSection>
              <SideSectionLabel>Direct Messages</SideSectionLabel>
              {DMS.map((dm, i) => (
                <DmRow key={dm.name} $shown={shownDms > i}>
                  <DmAvatar $bg={dm.color}>
                    {dm.init}
                    <OnlineDot $online={dm.online} />
                  </DmAvatar>
                  <DmName>{dm.name}</DmName>
                </DmRow>
              ))}
            </SideSection>
          )}
        </Sidebar>

        <ChatArea>
          <ChatHeader>
            <span className="hash">#</span>
            <span className="name">general</span>
          </ChatHeader>

          <MessagesArea>
            {MSGS.map((m, i) => (
              <React.Fragment key={i}>
                <Msg $shown={msgShown[i]}>
                  <Av $bg={m.color}>{m.init}</Av>
                  <MsgBody>
                    <MsgMeta>
                      <MsgUser color={m.color}>{m.user}</MsgUser>
                      <MsgTime>{m.time}</MsgTime>
                    </MsgMeta>
                    <MsgText>{m.text}</MsgText>
                    {i === 1 && (
                      <Reaction $shown={showReaction && msgShown[1]}>🎉 3</Reaction>
                    )}
                  </MsgBody>
                </Msg>
              </React.Fragment>
            ))}

            <TypingRow $shown={showTyping}>
              <Dots>
                <Dot d={0} /><Dot d={180} /><Dot d={360} />
              </Dots>
              <TypingLabel>{typingWho} is typing…</TypingLabel>
            </TypingRow>
          </MessagesArea>

          <InputRow>
            <InputMock>Message #general</InputMock>
          </InputRow>
        </ChatArea>
      </AppLayout>

      <ToastOverlay>
        <ToastItem $shown={showInviteToast}>
          <ToastIconEl>👤</ToastIconEl>
          <ToastText><strong>Bob</strong> was invited to #dev</ToastText>
        </ToastItem>
        <ToastItem $shown={showChannelToast}>
          <ToastIconEl>📢</ToastIconEl>
          <ToastText><strong>#announcements</strong> channel created</ToastText>
        </ToastItem>
      </ToastOverlay>
    </BrowserFrame>
  );
}

// ─── Background ──────────────────────────────────────────────────────────────

const Background = () => (
  <>
    <Orb $size={460} $top="-12%" $left="-10%" $color="rgba(100,220,10,0.55)"  $delay={0} $anim={1} />
    <Orb $size={360} $top="58%"  $left="68%"  $color="rgba(165,255,17,0.4)"   $delay={4} $anim={2} />
    <Orb $size={260} $top="62%"  $left="2%"   $color="rgba(80,180,10,0.35)"   $delay={7} $anim={3} />
    <Orb $size={180} $top="8%"   $left="76%"  $color="rgba(165,255,17,0.28)"  $delay={2} $anim={1} />
    <GridOverlay />
    <VignetteOverlay />
    <Ring $size={580} $duration={45} />
    <Ring $size={800} $duration={70} $reverse />
  </>
);

// ─── Section Primitives ───────────────────────────────────────────────────────

const Sect = styled.section<{ $alt?: boolean }>`
  position: relative;
  width: 100%;
  padding: 5.5rem 1.5rem;
  background: ${p => p.$alt ? 'rgba(255,255,255,0.012)' : 'transparent'};
  border-top: 1px solid rgba(255,255,255,0.04);
  overflow: hidden;
`;

const SectInner = styled.div`
  max-width: 1060px;
  margin: 0 auto;
`;

const SectCenter = styled(SectInner)`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
`;

const SectTag = styled.div`
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a5ff11;
  background: rgba(165,255,17,0.07);
  border: 1px solid rgba(165,255,17,0.15);
  border-radius: 100px;
  padding: 4px 14px;
  margin-bottom: 1.25rem;
`;

const H2 = styled.h2`
  font-size: clamp(1.75rem, 3.5vw, 2.6rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  color: #ffffff;
  margin: 0 0 1rem;
  line-height: 1.15;
`;

const Lead = styled.p`
  font-size: 0.93rem;
  color: rgba(255,255,255,0.36);
  line-height: 1.75;
  max-width: 560px;
  margin: 0 0 3rem;
`;

// ─── P2P Architecture Diagram ─────────────────────────────────────────────────

const DiagramWrap = styled.div`
  width: 100%;
  max-width: 700px;
  padding: 2.5rem 2rem 2rem;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.018);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(165,255,17,0.05) 0%, transparent 65%);
    pointer-events: none;
  }
`;

const DiagramRow = styled.div`
  display: grid;
  grid-template-columns: 185px 1fr 138px;
  align-items: center;
  margin: 4px 0;

  @media (max-width: 520px) {
    grid-template-columns: 130px 1fr 100px;
  }
`;

const NodeCard = styled.div<{ $idx: number }>`
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 13px 13px;
  border-radius: 10px;
  border: 1px solid rgba(165,255,17,0.22);
  background: rgba(165,255,17,0.04);
  ${p => css`animation: ${nodeGlow} 3.5s ${p.$idx * 1.1}s ease-in-out infinite;`}
`;

const NodeTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(255,255,255,0.85);
  white-space: nowrap;

  @media (max-width: 520px) {
    font-size: 0.63rem;
  }
`;

const NodePulse = styled.div`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a5ff11;
  box-shadow: 0 0 6px rgba(165,255,17,0.65);
  flex-shrink: 0;
`;

const NamespaceBox = styled.div`
  padding: 5px 8px 6px;
  border-radius: 6px;
  border: 1px solid rgba(165,255,17,0.12);
  background: rgba(165,255,17,0.025);
`;

const NamespaceLabel = styled.div`
  font-size: 0.54rem;
  font-weight: 600;
  color: rgba(165,255,17,0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
`;

const ContextBox = styled.div`
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.02);
  font-size: 0.58rem;
  font-weight: 500;
  color: rgba(255,255,255,0.38);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 520px) {
    font-size: 0.52rem;
  }
`;

const AppCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  padding: 10px 11px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.03);
`;

const AppTypeLabel = styled.div`
  font-size: 0.54rem;
  font-weight: 600;
  color: rgba(255,255,255,0.25);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  white-space: nowrap;
`;

const DiagramAppName = styled.div`
  font-size: 0.68rem;
  font-weight: 500;
  color: rgba(255,255,255,0.5);
  display: flex;
  align-items: center;
  gap: 4px;

  @media (max-width: 520px) {
    font-size: 0.6rem;
  }
`;

const WireTrack = styled.div`
  position: relative;
  height: 2px;
  background: rgba(165,255,17,0.1);
  margin: 0 8px;
  border-radius: 1px;
  overflow: visible;

  &::after {
    content: '';
    position: absolute;
    inset: -1px 0;
    background: linear-gradient(90deg, transparent 0%, rgba(165,255,17,0.18) 50%, transparent 100%);
    border-radius: 2px;
  }
`;

const WireLabel = styled.div`
  position: absolute;
  top: -17px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.54rem;
  font-weight: 600;
  color: rgba(165,255,17,0.4);
  letter-spacing: 0.03em;
  white-space: nowrap;
  pointer-events: none;
`;

const PacketDot = styled.div<{ $delay: string; $dur: string }>`
  position: absolute;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a5ff11;
  box-shadow: 0 0 10px rgba(165,255,17,0.85), 0 0 20px rgba(165,255,17,0.3);
  ${p => css`animation: ${packetTravel} ${p.$dur} ${p.$delay} ease-in-out infinite;`}
`;

const DiagramConnector = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 19px;
  margin: 2px 0;
`;

const VertLine = styled.div`
  width: 1px;
  height: 20px;
  background: linear-gradient(180deg, rgba(165,255,17,0.28), rgba(165,255,17,0.07));
  flex-shrink: 0;
`;

const SyncLabel = styled.div`
  font-size: 0.56rem;
  font-weight: 600;
  color: rgba(165,255,17,0.35);
  letter-spacing: 0.05em;
  white-space: nowrap;
`;

const DiagramLegend = styled.div`
  display: flex;
  justify-content: center;
  gap: 1.75rem;
  margin-top: 1.75rem;
  flex-wrap: wrap;
  padding-top: 1.25rem;
  border-top: 1px solid rgba(255,255,255,0.04);
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.7rem;
  color: rgba(255,255,255,0.3);
`;

const LegendDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a5ff11;
  box-shadow: 0 0 5px rgba(165,255,17,0.5);
  flex-shrink: 0;
`;

const LegendLine = styled.div`
  width: 20px;
  height: 2px;
  background: rgba(165,255,17,0.25);
  border-radius: 1px;
  flex-shrink: 0;
`;

const LegendVert = styled.div`
  width: 1px;
  height: 14px;
  background: rgba(165,255,17,0.2);
  flex-shrink: 0;
`;

function P2PDiagram() {
  return (
    <DiagramWrap>
      <DiagramRow>
        <NodeCard $idx={0}>
          <NodeTitle><NodePulse />Node 1</NodeTitle>
          <NamespaceBox>
            <NamespaceLabel>Namespace</NamespaceLabel>
            <ContextBox>Group / Context</ContextBox>
          </NamespaceBox>
        </NodeCard>
        <WireTrack>
          <WireLabel>JSON-RPC req &amp; res</WireLabel>
          <PacketDot $delay="0s"    $dur="2.3s" />
          <PacketDot $delay="1.15s" $dur="2.3s" />
        </WireTrack>
        <AppCard>
          <AppTypeLabel>Frontend App</AppTypeLabel>
          <DiagramAppName><span>👤</span>Alice</DiagramAppName>
        </AppCard>
      </DiagramRow>

      <DiagramConnector>
        <VertLine />
        <SyncLabel>P2P · CRDT Sync</SyncLabel>
      </DiagramConnector>

      <DiagramRow>
        <NodeCard $idx={1}>
          <NodeTitle><NodePulse />Node 2</NodeTitle>
          <NamespaceBox>
            <NamespaceLabel>Namespace</NamespaceLabel>
            <ContextBox>Group / Context</ContextBox>
          </NamespaceBox>
        </NodeCard>
        <WireTrack>
          <PacketDot $delay="0.65s" $dur="2.3s" />
          <PacketDot $delay="1.8s"  $dur="2.3s" />
        </WireTrack>
        <AppCard>
          <AppTypeLabel>Frontend App</AppTypeLabel>
          <DiagramAppName><span>👤</span>Bob</DiagramAppName>
        </AppCard>
      </DiagramRow>

      <DiagramConnector>
        <VertLine />
        <SyncLabel>P2P · CRDT Sync</SyncLabel>
      </DiagramConnector>

      <DiagramRow>
        <NodeCard $idx={2}>
          <NodeTitle><NodePulse />Node 3</NodeTitle>
          <NamespaceBox>
            <NamespaceLabel>Namespace</NamespaceLabel>
            <ContextBox>Group / Context</ContextBox>
          </NamespaceBox>
        </NodeCard>
        <WireTrack>
          <PacketDot $delay="1.3s" $dur="2.3s" />
          <PacketDot $delay="0.2s" $dur="2.3s" />
        </WireTrack>
        <AppCard>
          <AppTypeLabel>Frontend App</AppTypeLabel>
          <DiagramAppName><span>👤</span>Carol</DiagramAppName>
        </AppCard>
      </DiagramRow>

      <DiagramLegend>
        <LegendItem><LegendDot />Self-hosted node</LegendItem>
        <LegendItem><PacketDot as="div" $delay="0s" $dur="0s" style={{ position: 'static', animation: 'none', width: 8, height: 8 }} />Live packet</LegendItem>
        <LegendItem><LegendLine />Encrypted channel</LegendItem>
        <LegendItem><LegendVert />P2P mesh link</LegendItem>
      </DiagramLegend>
    </DiagramWrap>
  );
}

// ─── Feature Cards ────────────────────────────────────────────────────────────

const FeatGrid = styled.div`
  display: grid;
  width: 100%;
  grid-template-columns: 1fr;
  gap: 1rem;

  @media (min-width: 540px)  { grid-template-columns: repeat(2, 1fr); }
  @media (min-width: 1000px) { grid-template-columns: repeat(4, 1fr); }
`;

const FeatCard = styled.div`
  padding: 1.75rem 1.5rem;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  transition: border-color 0.2s, background 0.2s, transform 0.2s;

  &:hover {
    border-color: rgba(165,255,17,0.18);
    background: rgba(165,255,17,0.025);
    transform: translateY(-2px);
  }
`;

const FeatIcon = styled.div`
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: rgba(165,255,17,0.08);
  border: 1px solid rgba(165,255,17,0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a5ff11;
  flex-shrink: 0;
`;

const FeatTitle = styled.div`
  font-size: 0.92rem;
  font-weight: 700;
  color: rgba(255,255,255,0.88);
`;

const FeatDesc = styled.div`
  font-size: 0.82rem;
  color: rgba(255,255,255,0.34);
  line-height: 1.65;
`;

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="5" r="2"/>
        <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
        <line x1="12" y1="9" x2="7" y2="6.5"/><line x1="12" y1="9" x2="17" y2="6.5"/>
        <line x1="12" y1="15" x2="7" y2="17.5"/><line x1="12" y1="15" x2="17" y2="17.5"/>
      </svg>
    ),
    title: "Fully Decentralized",
    desc: "No central server. Every user runs their own node. No single point of failure, censorship, or data collection.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    title: "CRDT Sync",
    desc: "Conflict-free Replicated Data Types guarantee messages always merge cleanly across peers — even after network partitions.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    title: "Cryptographic Access",
    desc: "Workspaces are invite-only. Every membership is backed by cryptographic signatures — no impersonation, no backdoors.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
      </svg>
    ),
    title: "Self-Hosted Forever",
    desc: "Deploy on your own hardware, a VPS, or Calimero Desktop. Your infrastructure, your data, your rules.",
  },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQList = styled.div`
  width: 100%;
  max-width: 680px;
`;

const FAQRow = styled.div`
  border-bottom: 1px solid rgba(255,255,255,0.06);

  &:first-child { border-top: 1px solid rgba(255,255,255,0.06); }
`;

const FAQBtn = styled.button`
  width: 100%;
  background: none;
  border: none;
  padding: 1.2rem 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  cursor: pointer;
  text-align: left;
  font-size: 0.88rem;
  font-weight: 600;
  color: rgba(255,255,255,0.72);
  font-family: inherit;
  transition: color 0.15s;

  &:hover { color: #ffffff; }
`;

const FAQIcon = styled.div<{ $open: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid ${p => p.$open ? 'rgba(165,255,17,0.35)' : 'rgba(255,255,255,0.1)'};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: ${p => p.$open ? '#a5ff11' : 'rgba(255,255,255,0.3)'};
  transition: all 0.2s;
  transform: ${p => p.$open ? 'rotate(45deg)' : 'rotate(0deg)'};
`;

const FAQBody = styled.div<{ $open: boolean }>`
  max-height: ${p => p.$open ? '400px' : '0'};
  overflow: hidden;
  transition: max-height 0.35s ease;

  p {
    font-size: 0.84rem;
    color: rgba(255,255,255,0.36);
    line-height: 1.72;
    padding: 0 2.5rem 1.2rem 0;
    margin: 0;
  }
`;

const FAQS = [
  {
    q: "What is a Calimero node?",
    a: "A node (merod) is the core runtime that orchestrates synchronization, event handling, and blob distribution across a distributed network of peers. It wraps a DAG-based CRDT storage layer with WASM execution, libp2p networking, and lifecycle management. You self-host it — on bare metal, a VPS, or via Calimero Desktop. Each node exposes a JSON-RPC API (port 2528) and a WebSocket endpoint for real-time subscriptions; your frontend application talks exclusively to your own node.",
  },
  {
    q: "How does P2P sync work?",
    a: "Calimero uses a dual-path synchronization strategy. The primary path is Gossipsub broadcast: when a node executes a transaction it produces a delta, which propagates to all peers in ~100–200 ms. The fallback path is periodic P2P sync every 10–30 seconds — nodes open a direct stream, exchange DAG heads, and request any missing deltas. This guarantees eventual consistency even across packet loss, network partitions, or temporary node downtime. All deltas are causally ordered via a DAG, so they can arrive out of order and still be applied correctly.",
  },
  {
    q: "What is a CRDT?",
    a: "A Conflict-free Replicated Data Type (CRDT) is a data structure whose merge semantics guarantee that any set of concurrent updates always converges to the same state, regardless of application order. Calimero's storage layer uses CRDT collections (maps, sets, ordered sequences) backed by a DAG that tracks causal dependencies between deltas. When two nodes have diverged, their states can be merged deterministically with no coordination or conflict-resolution step required.",
  },
  {
    q: "Who can read my messages?",
    a: "Only nodes whose identities hold an active membership in the context. Membership is invite-only: invitations are cryptographically signed and can be anchored on-chain for tamper-evidence. Each context maintains its own isolated CRDT state — Context A cannot access Context B's state. Private storage (marked #[app::private]) is node-local and never replicated to peers. There are no relay servers; messages travel directly between member nodes.",
  },
  {
    q: "Do I need to keep my node online 24/7?",
    a: "No. The periodic P2P sync path (every 10–30 s) is specifically designed for catch-up after downtime. When your node reconnects it opens a stream to a peer, exchanges DAG heads, and pulls any deltas it missed — the DAG's causal-ordering ensures they are applied in correct order regardless of how long the node was offline. For always-on availability, deploy merod on a VPS or server.",
  },
  {
    q: "Can Calimero read my messages?",
    a: "No. Calimero ships the merod runtime and client SDKs but operates no relay infrastructure and holds no keys. State lives exclusively on the nodes of context members. Every state transition is executed inside a deterministic WASM sandbox on your node, tied to your executor identity via the audit log. Selective disclosure lets applications emit only hashed or redacted event payloads, keeping full data on the owner's node.",
  },
];

function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <FAQList>
      {FAQS.map((item, i) => (
        <FAQRow key={i}>
          <FAQBtn onClick={() => setOpen(open === i ? null : i)}>
            {item.q}
            <FAQIcon $open={open === i}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </FAQIcon>
          </FAQBtn>
          <FAQBody $open={open === i}>
            <p>{item.a}</p>
          </FAQBody>
        </FAQRow>
      ))}
    </FAQList>
  );
}

// ─── Props & Component ────────────────────────────────────────────────────────

interface LandingPageProps {
  onUseOnWeb?: () => void;
  connectButton?: React.ReactNode;
  children?: React.ReactNode;
}

export default function LandingPage({ connectButton, children }: LandingPageProps) {
  if (children) {
    return (
      <BackgroundPage>
        <Background />
        {children}
      </BackgroundPage>
    );
  }

  return (
    <LandingRoot>
      {/* ── Hero ── */}
      <HeroSection>
        <Background />

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
            Mero Chat runs on your own Calimero node — P2P, powered by CRDTs for
            conflict-free sync across peers. No servers, no surveillance, no data collection.
            Your conversations are cryptographically yours.
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
              P2P · CRDT sync
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

          {connectButton ? (
            <ConnectButtonWrapper>{connectButton}</ConnectButtonWrapper>
          ) : (
            <TerminalBox>
              <StatusDot />
              <TerminalText>
                Open <span className="cmd">Calimero Desktop</span> and launch Mero Chat
                <span className="cursor" />
              </TerminalText>
            </TerminalBox>
          )}
        </Content>

        <PreviewSection>
          <PreviewScaleWrap>
            <PreviewScaleInner>
              <ChatPreview />
            </PreviewScaleInner>
          </PreviewScaleWrap>
          <PreviewCaption>Live preview · P2P sync via CRDTs across nodes</PreviewCaption>
        </PreviewSection>
      </HeroSection>

      {/* ── P2P Architecture ── */}
      <Sect>
        <SectCenter>
          <SectTag>Architecture</SectTag>
          <H2>Your node. Your data. Your rules.</H2>
          <Lead>
            Each user runs their own node. Mero Chat syncs directly between nodes — no
            relay servers, no cloud middlemen. Packets travel peer-to-peer, encrypted end-to-end.
          </Lead>
          <P2PDiagram />
        </SectCenter>
      </Sect>

      {/* ── Features ── */}
      <Sect $alt>
        <SectCenter>
          <SectTag>Why Mero Chat</SectTag>
          <H2>Built different</H2>
          <Lead>
            Most chat apps store your data on their servers. Mero Chat doesn't.
            Here's what makes it fundamentally different.
          </Lead>
          <FeatGrid>
            {FEATURES.map(f => (
              <FeatCard key={f.title}>
                <FeatIcon>{f.icon}</FeatIcon>
                <FeatTitle>{f.title}</FeatTitle>
                <FeatDesc>{f.desc}</FeatDesc>
              </FeatCard>
            ))}
          </FeatGrid>
        </SectCenter>
      </Sect>

      {/* ── FAQ ── */}
      <Sect>
        <SectCenter>
          <SectTag>FAQ</SectTag>
          <H2>Common questions</H2>
          <Lead>
            Everything you need to know about Mero Chat and the Calimero network.
          </Lead>
          <FAQSection />
        </SectCenter>
      </Sect>

    </LandingRoot>
  );
}
