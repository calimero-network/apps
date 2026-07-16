import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';

interface JoinModalProps {
  onJoin: (invitationCode: string) => Promise<void>;
  onClose: () => void;
}


export default function JoinModal({ onJoin, onClose }: JoinModalProps) {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !joining) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joining, onClose]);

  const handleJoin = async () => {
    if (!code.trim() || joining) return;
    setJoining(true);
    setError(null);
    try {
      await onJoin(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join — check the invite code.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Overlay onClick={() => !joining && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="join-title">
        <Close onClick={() => !joining && onClose()} aria-label="Close">×</Close>

        <IconBadge aria-hidden>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.greenInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </IconBadge>

        <h3 id="join-title">Join with invitation</h3>
        <p className="sub">Paste the invite code you received to join the workspace.</p>

        <Field>
          <label htmlFor="join-code">Invite code</label>
          <textarea
            id="join-code"
            data-testid="join-code-input"
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="Paste your invite code…"
            rows={4}
            disabled={joining}
          />
        </Field>

        {error && <ErrorLine>{error}</ErrorLine>}

        <Actions>
          <SecondaryBtn onClick={onClose} disabled={joining}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="join-submit-btn" onClick={handleJoin} disabled={!code.trim() || joining}>
            {joining ? <Spin /> : 'Join workspace'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}`;
const spin = keyframes`to{transform:rotate(360deg);}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.45); backdrop-filter: blur(4px);
  animation: ${fadeIn} 0.18s ease both;
`;
const Dialog = styled.div`
  position: relative; width: 100%; max-width: 440px;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 28px 26px 24px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
`;
const Close = styled.button`
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const IconBadge = styled.div`
  width: 48px; height: 48px; margin-bottom: 16px; display: grid; place-items: center; border-radius: 14px;
  background: rgba(164,255,17,0.16); border: 1px solid rgba(164,255,17,0.4);
`;
const Field = styled.div`
  margin: 22px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  textarea {
    width: 100%; resize: vertical; min-height: 84px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.5;
    color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 11px; padding: 10px 12px;
    outline: none; word-break: break-all;
    &::placeholder { color: ${C.mutedSoft}; font-family: -apple-system, sans-serif; }
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 4px rgba(164,255,17,0.18); }
    &:disabled { opacity: 0.6; }
  }
`;
const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const btn = `
  padding: 11px 18px; font-size: 13.5px; font-weight: 600; letter-spacing: -0.1px; border-radius: 11px; cursor: pointer;
  transition: transform 0.15s, box-shadow 0.2s, background 0.18s, border-color 0.18s;
  &:disabled { opacity: 0.6; cursor: default; }
`;
const SecondaryBtn = styled.button`
  ${btn}
  color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line};
  &:hover:not(:disabled) { background: ${C.paper2}; border-color: ${C.lineDark}; }
`;
const PrimaryBtn = styled.button`
  ${btn}
  min-width: 150px; display: inline-flex; align-items: center; justify-content: center;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  &:hover:not(:disabled) { background: ${C.greenHover}; box-shadow: 0 10px 28px rgba(164,255,17,0.4); transform: translateY(-1px); }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid rgba(14,20,15,0.3); border-top-color: ${C.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
