/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * node login (a node URL, the auth frontend, the desktop hand-off): on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev, the
 * Cloud cluster in production) and the account is a passkey.
 */
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { closeButton, dialogSurface, field, overlay, primaryPill, secondaryPill } from './glass';
import { describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from '../lib/workspaces';

export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const [name, setName] = useState('');
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (open && api.session.status === 'signed-in') onClose();
  }, [open, api.session.status, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !api.busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, api.busy, onClose]);

  if (!open) return null;

  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <Overlay onClick={() => !api.busy && onClose()}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        data-testid="signin-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <Close type="button" onClick={() => !api.busy && onClose()} aria-label="Close">
          ×
        </Close>
        <h3 id="signin-title">{invited ? "You're invited" : 'Sign in'}</h3>
        <Hint>
          {invited ? 'Sign in, or create an account, to join the workspace you were invited to. ' : ''}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ''}
        </Hint>

        {api.session.status === 'connecting' && <Hint>Connecting…</Hint>}
        {api.session.status === 'unconfigured' && <Err role="alert">{api.session.message}</Err>}

        {api.session.status === 'signed-out' && (
          <>
            <Primary
              type="button"
              data-testid="signin-passkey"
              disabled={api.busy}
              onClick={() => void api.signIn()}
            >
              {api.busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
            </Primary>
            <Label htmlFor="signup-name">New here? Your name</Label>
            <Input
              id="signup-name"
              data-testid="signup-name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) void api.signUp(name.trim());
              }}
              disabled={api.busy}
            />
            <Secondary
              type="button"
              data-testid="signup-passkey"
              disabled={api.busy || !name.trim()}
              onClick={() => void api.signUp(name.trim())}
            >
              Create an account
            </Secondary>
          </>
        )}

        {api.error && (
          <Err role="alert" data-testid="signin-error">
            {api.error}
          </Err>
        )}
      </Dialog>
    </Overlay>
  );
}

export const Overlay = styled.div`
  ${overlay}
  z-index: 300;
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;

export const Dialog = styled.div`
  ${dialogSurface}
  width: 100%; max-width: 420px;
  max-height: calc(100vh - 40px); overflow-y: auto;
  padding: 30px 28px 24px;
  display: flex; flex-direction: column; gap: 10px;
  h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; margin: 0; }
`;

export const Close = styled.button`
  ${closeButton}
  position: absolute; top: 16px; right: 16px;
`;

export const Hint = styled.p`margin: 0; font-size: 13.5px; line-height: 1.5; color: ${C.muted};`;
export const Err = styled.p`margin: 0; font-size: 12.5px; line-height: 1.45; color: ${C.danger};`;
export const Primary = styled.button`${primaryPill} width: 100%;`;
export const Secondary = styled.button`${secondaryPill} width: 100%;`;
const Label = styled.label`margin-top: 8px; font-size: 12px; color: ${C.mutedSoft};`;
const Input = styled.input`${field}`;
