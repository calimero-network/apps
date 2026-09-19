import { useCallback, useEffect, useRef, useState } from 'react';
import { styled } from 'styled-components';
import { useCalimero } from '../lib/useCalimero';
import { Button, colors } from '@calimero-network/mero-ui';
import {
  parseInvitation,
  redeemInvitation,
  type RedeemStage,
} from '../api/invitationJoin';

// ── The invitation prompt ────────────────────────────────────────────────────
//
// Mounted at APP level (see App.tsx), not on a page: an invitation link can land
// on any route — `/`, `/docs`, a deep link the launcher rewrote, a path that
// does not exist — and the prompt has to be there wherever it lands.
//
// The join itself lives in `api/invitationJoin.ts`, shared with the dashboard's
// paste box. What used to be here was a 400-line component that owned the whole
// redemption: two nested retry ladders, a sync poll reading a field it could not
// see, and its own copy of the name resolution that the dashboard had a
// different copy of.

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const PopupContainer = styled.div`
  background: #1a1a1f;
  border: 1px solid ${colors.semantic.success.value}40;
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
`;

const Title = styled.h2`
  color: ${colors.semantic.success.value};
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 1rem;
  text-align: center;
`;

const Message = styled.div<{ type?: 'success' | 'error' | 'info' }>`
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  margin-bottom: 1rem;
  color: ${({ type }) =>
    type === 'error'
      ? colors.semantic.error.value
      : colors.semantic.success.value};
  background: ${({ type }) =>
    type === 'error'
      ? `${colors.semantic.error.value}20`
      : `${colors.semantic.success.value}20`};
`;

const STAGE_COPY: Record<RedeemStage, { title: string; body: string }> = {
  joining: {
    title: 'Joining the agreement…',
    body: 'Asking your node to accept the invitation.',
  },
  syncing: {
    title: 'Syncing the agreement…',
    body: 'Waiting for the agreement to replicate onto your node. This can take a moment.',
  },
  registering: {
    title: 'Registering you…',
    body: 'Recording you as a participant so you can sign.',
  },
  naming: {
    title: 'Almost there…',
    body: 'Saving the agreement to your dashboard.',
  },
};

const ButtonGroup = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
`;

interface InvitationHandlerPopupProps {
  /** The captured invitation — a link, a code, or a pasted payload. */
  invitation: string;
  onSuccess: (agreement: { contextId: string; name: string }) => void;
  onError: () => void;
}

export default function InvitationHandlerPopup({
  invitation,
  onSuccess,
  onError,
}: InvitationHandlerPopupProps) {
  const { app } = useCalimero();
  const [stage, setStage] = useState<RedeemStage>('joining');
  const [errorMessage, setErrorMessage] = useState('');
  const attempted = useRef(false);

  // The invitation's own name, shown while the join is in flight so the prompt
  // can say WHAT you are joining. Untrusted — it is outside the signature — and
  // superseded by the contract's name the moment the join completes.
  const previewName = parseInvitation(invitation)?.contextName;

  const run = useCallback(async () => {
    if (attempted.current) return;
    attempted.current = true;
    setErrorMessage('');
    setStage('joining');

    try {
      const result = await redeemInvitation(invitation, app, setStage);
      onSuccess({ contextId: result.contextId, name: result.name });
    } catch (error) {
      attempted.current = false;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while joining.',
      );
    }
  }, [app, invitation, onSuccess]);

  useEffect(() => {
    // `app` is created asynchronously by the provider. Starting without it puts
    // every call on the apiClient fallback path, which is why the old component
    // had a twenty-attempt polling loop waiting for it; waiting for the value to
    // exist is the same thing without the loop.
    if (!app) return;
    void run();
  }, [app, run]);

  if (errorMessage) {
    return (
      <Overlay>
        <PopupContainer>
          <Title>Could not join</Title>
          <Message type="error">{errorMessage}</Message>
          <ButtonGroup>
            <Button
              onClick={() => void run()}
              variant="primary"
              style={{ flex: 1 }}
            >
              Try again
            </Button>
            <Button onClick={onError} variant="secondary" style={{ flex: 1 }}>
              Cancel
            </Button>
          </ButtonGroup>
        </PopupContainer>
      </Overlay>
    );
  }

  const copy = STAGE_COPY[stage];
  return (
    <Overlay>
      <PopupContainer>
        <Title>{previewName ? `Joining “${previewName}”…` : copy.title}</Title>
        <Message type="info">{copy.body}</Message>
      </PopupContainer>
    </Overlay>
  );
}
