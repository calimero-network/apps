import React, { useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens as t } from '../theme';
import { generateInvitationDeepLink, generateInvitationUrl } from '../utils/invitation';

interface InviteModalProps {
  onInvite: () => Promise<unknown>;
  onClose: () => void;
}

type CopyTarget = 'web' | 'desktop';

export default function InviteModal({ onInvite, onClose }: InviteModalProps) {
  const [payload, setPayload] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const webUrl = useMemo(() => (payload ? generateInvitationUrl(payload) : ''), [payload]);
  const desktopUrl = useMemo(() => (payload ? generateInvitationDeepLink(payload) : ''), [payload]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(JSON.stringify(await onInvite()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (target: CopyTarget) => {
    const value = target === 'web' ? webUrl : desktopUrl;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      setTimeout(() => setCopied(null), 1800);
    } catch { /* clipboard blocked — the link stays selectable in the field */ }
  };

  return (
    <Overlay onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inv-title">
        <Close onClick={onClose} aria-label="Close">×</Close>

        <IconBadge aria-hidden>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.color.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
        </IconBadge>

        <h3 id="inv-title">Invite to workspace</h3>
        <p className="sub">Generate an invite link and share it with anyone you want to join this workspace.</p>

        {!payload ? (
          <PrimaryBtn data-testid="generate-invite-btn" style={{ width: '100%', marginTop: 22 }} onClick={handleGenerate} disabled={loading}>
            {loading ? <Spin /> : 'Generate invite link'}
          </PrimaryBtn>
        ) : (
          <>
            <Field>
              <label>Invite link</label>
              <textarea data-testid="invite-code-output" readOnly value={webUrl} rows={3} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <PrimaryBtn data-testid="copy-invite-btn" style={{ width: '100%' }} onClick={() => void handleCopy('web')}>
              {copied === 'web' ? 'Copied ✓' : 'Copy invite link'}
            </PrimaryBtn>
            <SecondaryBtn data-testid="copy-desktop-link-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => void handleCopy('desktop')}>
              {copied === 'desktop' ? 'Copied ✓' : 'Copy desktop link'}
            </SecondaryBtn>
            <p className="hint">
              Opening the link joins the workspace directly. The desktop link is for
              Windows and Linux, which can’t intercept the web one.
            </p>
          </>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
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
  background: rgba(6,7,9,0.6);
  animation: ${fadeIn} 0.15s ease both;
`;
const Dialog = styled.div`
  position: relative; width: 100%; max-width: 440px;
  background: ${t.color.panel}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusModal};
  padding: 28px 26px 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  font-family: ${t.font.sans}; color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
  .hint { margin: 10px 0 0; font-size: 12px; color: ${t.color.text3}; text-align: center; }
`;
const Close = styled.button`
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${t.color.text3}; background: transparent; border: none; border-radius: 6px; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
`;
const IconBadge = styled.div`
  width: 44px; height: 44px; margin-bottom: 16px; display: grid; place-items: center; border-radius: 10px;
  background: ${t.color.accentDim}; border: 1px solid ${t.color.accentBorder};
`;
const Field = styled.div`
  margin: 22px 0 12px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${t.color.text2}; margin-bottom: 7px; }
  textarea {
    width: 100%; resize: vertical; min-height: 84px;
    font-family: ${t.font.mono}; font-size: 12px; line-height: 1.5;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 10px 12px;
    outline: none; word-break: break-all;
    &:focus { border-color: ${t.color.accentBorder}; }
  }
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 18px; font-size: 13px; font-weight: 600; border-radius: ${t.radius}; cursor: pointer;
  color: ${t.color.onAccent}; background: ${t.color.accent}; border: 1px solid transparent;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #b6ff5e; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const SecondaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 18px; font-size: 13px; font-weight: 600; border-radius: ${t.radius}; cursor: pointer;
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { background: ${t.color.raised2}; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${t.color.urgent};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid rgba(12,16,5,0.3); border-top-color: ${t.color.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
