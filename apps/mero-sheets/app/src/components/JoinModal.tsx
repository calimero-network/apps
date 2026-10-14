import React, { useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import { closeButton, dialogSurface, overlay, primaryPill, secondaryPill } from './glass';
import { decodeInvite } from '../lib/inviteCodec';
import { invitationFromRaw } from '../lib/inviteLink';

interface JoinModalProps {
  /** Receives the extracted CODE, never the pasted link. */
  onJoin: (code: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Paste an invitation.
 *
 * Takes a LINK now, as well as a raw code, because a link is what people are
 * sent and what they have in their clipboard. The old field took only the code,
 * so pasting the link you were given failed with "check the invite code" — the
 * one thing you had done correctly.
 *
 * The paste is decoded locally before anything is sent anywhere, so the dialog
 * can say what the invitation is FOR while you are still looking at it. That is
 * pure and free: `decodeInvite` touches no network and no session.
 */
export default function JoinModal({ onJoin, onClose }: JoinModalProps) {
  const [input, setInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !joining) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joining, onClose]);

  // A link, a deep link, a bare query string or the code itself all reduce to
  // the same code here; `null` means there is nothing recognisable in the box.
  const code = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return invitationFromRaw(trimmed) ?? trimmed;
  }, [input]);

  const preview = useMemo(() => (code ? decodeInvite(code) : null), [code]);

  const handleJoin = async () => {
    if (!code || joining) return;
    if (!preview) {
      setError(
        'That does not look like a Calimero invitation. Paste the whole link you were sent.',
      );
      return;
    }
    setJoining(true);
    setError(null);
    try {
      await onJoin(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Overlay onClick={() => !joining && onClose()}>
      <Dialog
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-title"
        data-testid="join-modal"
      >
        <Close onClick={() => !joining && onClose()} aria-label="Close">
          ×
        </Close>

        <h3 id="join-title">Join with an invitation</h3>
        <p className="sub">
          Paste the invitation link you were sent. A raw invite code works too.
        </p>

        <Field>
          <label htmlFor="join-code">Invitation link or code</label>
          <textarea
            id="join-code"
            data-testid="field-invitation"
            autoFocus
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="https://links.calimero.network/…"
            rows={3}
            disabled={joining}
          />
        </Field>

        {preview && (
          <Preview data-testid="join-preview">
            Invitation to{' '}
            <strong>{preview.groupAlias ?? 'a mero-sheets workspace'}</strong>
            {preview.projectName ? <> · opens “{preview.projectName}”</> : null}
          </Preview>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}

        <Actions>
          <SecondaryBtn onClick={onClose} disabled={joining}>
            Cancel
          </SecondaryBtn>
          <PrimaryBtn
            onClick={() => void handleJoin()}
            disabled={!code || joining}
            data-testid="action-join-workspace"
          >
            {joining ? <Spin /> : 'Join'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}

const spin = keyframes`to{transform:rotate(360deg);}`;

const Overlay = styled.div`
  ${overlay}
  z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;
const Dialog = styled.div`
  ${dialogSurface}
  width: 100%; max-width: 440px;
  padding: 30px 28px 26px;
  h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
`;
const Close = styled.button`
  ${closeButton}
  position: absolute; top: 16px; right: 16px;
`;
const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  textarea {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; line-height: 1.5;
    color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 12px; padding: 10px 12px;
    outline: none; word-break: break-all;
    &::placeholder { color: ${C.mutedSoft}; font-family: -apple-system, sans-serif; }
    &:focus { border-color: var(--glass-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--glass-accent-solid) 18%, transparent); }
    &:disabled { opacity: 0.6; }
  }
`;
const Preview = styled.p`
  margin: 12px 0 0; padding: 10px 12px;
  font-size: 12.5px; line-height: 1.5; color: ${C.muted};
  background: var(--glass-sunken); border: 1px solid var(--glass-line); border-radius: 10px;
  strong { color: ${C.ink}; font-weight: 600; }
`;
const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const SecondaryBtn = styled.button`
  ${secondaryPill}
`;
const PrimaryBtn = styled.button`
  ${primaryPill}
  min-width: 120px;
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid color-mix(in srgb, var(--glass-on-ink) 35%, transparent); border-top-color: var(--glass-on-ink);
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
