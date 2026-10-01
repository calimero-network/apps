import React, { useEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { sanitizeHtml } from '../virtualized-chat/utils';

// ── Design tokens (aligned with BaseModal: #111113 surface, 0.08 border,
//    mero-green accent #a5ff11) ───────────────────────────────────────────

const ACCENT_GREEN = '#a5ff11';
const ACCENT_GREEN_TINT_BG = 'rgba(165, 255, 17, 0.1)';
const ACCENT_GREEN_TINT_BORDER = 'rgba(165, 255, 17, 0.22)';

// ── Animation ──────────────────────────────────────────────────────────────

const shrink = keyframes`
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
`;

// ── Layout ─────────────────────────────────────────────────────────────────

const ToastContainer = styled.div<{ $isVisible: boolean }>`
  position: relative;
  width: 360px;
  max-width: calc(100vw - 2rem);
  background: #111113;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(10px);
  overflow: hidden;
  transform: translateX(${(p) => (p.$isVisible ? '0' : '110%')});
  opacity: ${(p) => (p.$isVisible ? 1 : 0)};
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.625rem;
  padding: 0.875rem 0.875rem 0.5rem 0.875rem;
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
  flex: 1;
`;

const TitleIcon = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: ${ACCENT_GREEN_TINT_BG};
  border: 1px solid ${ACCENT_GREEN_TINT_BORDER};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: ${ACCENT_GREEN};
  font-size: 12px;
  font-weight: 700;
`;

const Title = styled.div`
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
`;

const Body = styled.div`
  padding: 0 0.875rem 0.875rem calc(0.875rem + 26px + 0.625rem);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.5;
  word-wrap: break-word;

  p { margin: 0 0 0.25rem 0; padding: 0; }
  p:last-child { margin-bottom: 0; }
  a { color: ${ACCENT_GREEN}; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .mention {
    background: rgba(165, 255, 17, 0.12);
    color: ${ACCENT_GREEN};
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
  }
  code {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 11.5px;
  }
`;

const ProgressTrack = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: rgba(255, 255, 255, 0.04);
`;

const progressBarStyle = css<{ $duration: number; $running: boolean }>`
  height: 100%;
  background: linear-gradient(
    90deg,
    rgba(165, 255, 17, 0.55),
    rgba(165, 255, 17, 0.9)
  );
  transform-origin: left center;
  animation: ${shrink} ${(p) => p.$duration}ms linear forwards;
  animation-play-state: ${(p) => (p.$running ? 'running' : 'paused')};
`;

const ProgressBar = styled.div<{ $duration: number; $running: boolean }>`
  ${progressBarStyle}
`;

// ── Icons ──────────────────────────────────────────────────────────────────

const ICONS: Record<'channel' | 'dm' | 'mention', React.ReactNode> = {
  channel: <span aria-hidden>#</span>,
  dm: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  mention: <span aria-hidden>@</span>,
};

// ── Component ──────────────────────────────────────────────────────────────

interface CustomToastProps {
  title: string;
  message: string;
  type: 'channel' | 'dm' | 'mention';
  duration?: number;
  onClose: () => void;
}

export const CustomToast: React.FC<CustomToastProps> = ({
  title,
  message,
  type,
  duration = 5000,
  onClose,
}) => {
  // Start hidden, slide in on the next frame so the transition animates
  // instead of snapping. Mirrors the entrance pattern used elsewhere in
  // the app (BaseModal's fadeIn keyframe + cubic-bezier transform).
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss after `duration`, but pause the timer while hovered so
  // users can read longer messages without it disappearing under their
  // cursor. The progress bar animation is paused in sync.
  useEffect(() => {
    if (isPaused) return;
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => closeRef.current(), 280);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, isPaused]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => closeRef.current(), 280);
  };

  const sanitizedMessage = sanitizeHtml(message);

  return (
    <ToastContainer
      $isVisible={isVisible}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="status"
      aria-live="polite"
    >
      <Header>
        <TitleGroup>
          <TitleIcon>{ICONS[type]}</TitleIcon>
          <Title>{title}</Title>
        </TitleGroup>
        <CloseButton onClick={handleClose} aria-label="Dismiss notification">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </CloseButton>
      </Header>
      <Body dangerouslySetInnerHTML={{ __html: sanitizedMessage }} />
      <ProgressTrack>
        <ProgressBar $duration={duration} $running={isVisible && !isPaused} />
      </ProgressTrack>
    </ToastContainer>
  );
};
