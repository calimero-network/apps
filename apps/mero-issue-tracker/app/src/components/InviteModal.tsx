import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import { encodeInvitation } from '../utils/invitation';

interface InviteModalProps {
  onInvite: () => Promise<unknown>;
  onClose: () => void;
}


export default function InviteModal({ onInvite, onClose }: InviteModalProps) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onInvite();
      // Wrap the raw invitation in a single compact, copy-safe base64 code.
      setCode(encodeInvitation(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — no-op */ }
  };

  return (
    <Overlay onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inv-title">
        <Close onClick={onClose} aria-label="Close">×</Close>

        <IconBadge aria-hidden>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.greenInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
        </IconBadge>

        <h3 id="inv-title">Invite to workspace</h3>
        <p className="sub">Generate an invite code and share it with anyone you want to join this workspace.</p>

        {!code ? (
          <PrimaryBtn data-testid="generate-invite-btn" style={{ width: '100%', marginTop: 22 }} onClick={handleGenerate} disabled={loading}>
            {loading ? <Spin /> : 'Generate invite code'}
          </PrimaryBtn>
        ) : (
          <>
            <Field>
              <label>Invite code</label>
              <textarea data-testid="invite-code-output" readOnly value={code} rows={4} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <PrimaryBtn data-testid="copy-invite-btn" style={{ width: '100%' }} onClick={handleCopy}>
              {copied ? 'Copied ✓' : 'Copy invite code'}
            </PrimaryBtn>
            <p className="hint">The recipient pastes this into “Join with invitation”.</p>
          </>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
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
  .hint { margin: 10px 0 0; font-size: 12.5px; color: ${C.mutedSoft}; text-align: center; }
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
  margin: 22px 0 12px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  textarea {
    width: 100%; resize: vertical; min-height: 84px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.5;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 11px; padding: 10px 12px;
    outline: none; word-break: break-all;
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 4px rgba(164,255,17,0.18); }
  }
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 18px; font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  transition: background 0.18s, box-shadow 0.2s, transform 0.15s;
  &:hover:not(:disabled) { background: ${C.greenHover}; box-shadow: 0 10px 28px rgba(164,255,17,0.4); transform: translateY(-1px); }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid rgba(14,20,15,0.3); border-top-color: ${C.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
