import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import type { RedeemOutcome } from '@calimero-apps/invite';
import { tokens as t } from '../theme';
import { inviteFailureCopy } from '../utils/redeemInvite';

interface JoinModalProps {
  /** Redeems the code. A failure is shown here; on success the caller closes the dialog. */
  onJoin: (invitationCode: string) => Promise<RedeemOutcome>;
  onClose: () => void;
  /** Prefill from a captured deep link; `autoSubmit` also joins straight away. */
  initialCode?: string;
  autoSubmit?: boolean;
}

export default function JoinModal({ onJoin, onClose, initialCode = '', autoSubmit = false }: JoinModalProps) {
  const [code, setCode] = useState(initialCode);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the failure shown could go differently on another attempt. A final
  // one (an expired or refused invitation) offers no retry until the code changes.
  const [retryable, setRetryable] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !joining) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joining, onClose]);

  const handleJoin = useCallback(async (value: string) => {
    if (!value.trim() || joining) return;
    setJoining(true);
    setError(null);
    setRetryable(true);
    try {
      const outcome = await onJoin(value.trim());
      if (outcome.status === 'failed') {
        setError(inviteFailureCopy(outcome));
        setRetryable(outcome.retryable);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join — check the invite link.');
    } finally {
      setJoining(false);
    }
  }, [joining, onJoin]);

  // A deep-link arrival joins on its own; the field stays populated so a failure
  // leaves the user one click from retrying rather than back at a blank form.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!autoSubmit || autoJoined.current || !initialCode.trim()) return;
    autoJoined.current = true;
    void handleJoin(initialCode);
  }, [autoSubmit, initialCode, handleJoin]);

  return (
    <Overlay onClick={() => !joining && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="join-title">
        <Close onClick={() => !joining && onClose()} aria-label="Close">×</Close>

        <IconBadge aria-hidden>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.color.accentText} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </IconBadge>

        <h3 id="join-title">Join with invitation</h3>
        <p className="sub">Paste the invite link you received to join the workspace.</p>

        <Field>
          <label htmlFor="join-code">Invite link</label>
          <textarea
            id="join-code"
            data-testid="join-code-input"
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="Paste your invite link…"
            rows={4}
            disabled={joining}
          />
        </Field>

        {error && <ErrorLine>{error}</ErrorLine>}

        <Actions>
          <SecondaryBtn onClick={onClose} disabled={joining}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="join-submit-btn" onClick={() => void handleJoin(code)} disabled={!code.trim() || joining || (error !== null && !retryable)}>
            {joining ? <Spin /> : error && retryable ? 'Try again' : 'Join workspace'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}`;
const spin = keyframes`to{transform:rotate(360deg);}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: ${t.color.scrim};
  /* The overlay is fixed itself and holds only its dialog, so this blur
     cannot trap anything. */
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  animation: ${fadeIn} 0.15s ease both;
`;
const Dialog = styled.div`
  position: relative; width: 100%; max-width: 440px;
  background: ${t.color.panel}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusModal};
  padding: 30px 28px 26px; box-shadow: ${t.shadowFloat};
  max-height: calc(100dvh - 40px); overflow-y: auto;
  font-family: ${t.font.sans}; color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 8px; padding-right: 28px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
const Close = styled.button`
  position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${t.color.text3}; background: transparent; border: none; border-radius: 999px; cursor: pointer;
  &:hover { background: ${t.color.hover}; color: ${t.color.text}; }
`;
const IconBadge = styled.div`
  width: 44px; height: 44px; margin-bottom: 16px; display: grid; place-items: center; border-radius: 10px;
  background: ${t.color.accentDim}; border: 1px solid ${t.color.accentBorder};
`;
const Field = styled.div`
  margin: 22px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${t.color.text2}; margin-bottom: 7px; }
  textarea {
    width: 100%; resize: vertical; min-height: 84px;
    font-family: ${t.font.mono}; font-size: 12px; line-height: 1.5;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 10px 12px;
    outline: none; word-break: break-all;
    &::placeholder { color: ${t.color.text3}; font-family: ${t.font.sans}; }
    &:focus { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
    &:disabled { opacity: 0.6; }
  }
`;
const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const btn = `
  padding: 10px 18px; font-size: 13px; font-weight: 600; border-radius: ${t.radiusPill}; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:disabled { opacity: 0.6; cursor: default; }
`;
const SecondaryBtn = styled.button`
  ${btn}
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  &:hover:not(:disabled) { background: ${t.color.raised2}; }
`;
const PrimaryBtn = styled.button`
  ${btn}
  min-width: 150px; display: inline-flex; align-items: center; justify-content: center;
  color: ${t.color.onAccent}; background: ${t.color.accent}; border: 1px solid transparent;
  &:hover:not(:disabled) { background: ${t.color.accentHover}; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${t.color.urgent};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid color-mix(in srgb, ${t.color.onAccent} 30%, transparent); border-top-color: ${t.color.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
