import { useCallback, useRef, useState } from 'react';
import { styled } from 'styled-components';
import { useCalimero } from '../lib/useCalimero';
import { shouldRetain } from '@calimero-apps/invite';
import {
  InvitationRedeemError,
  joinWorkspaceFromInvitation,
  parseInvitation,
  type RedeemStage,
} from '../api/invitationJoin';

// ── The invitation prompt ────────────────────────────────────────────────────
//
// Mounted at APP level (see App.tsx), not on a page: an invitation link can land
// on any route — `/`, `/docs`, a deep link the launcher rewrote, a path that
// does not exist — and the prompt has to be there wherever it lands.
//
// It ASKS FIRST. Opening a link is not consent to join: the prompt names what
// the invitation is for and joins only on "Join". It used to start the join
// the moment it mounted, so any page that could get a link opened in your
// browser could put your node into a workspace.
//
// The join itself lives in `api/invitationJoin.ts`.

// The glass dialog look, from the `--sign-*` tokens (src/index.css), so the
// prompt follows the light/dark switch like the rest of the app.
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: var(--sign-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 500;
`;

const PopupContainer = styled.div`
  width: 100%;
  max-width: 440px;
  padding: 28px;
  border-radius: var(--sign-radius-xl);
  background: var(--sign-solid);
  border: 1px solid var(--sign-edge);
  box-shadow: var(--sign-shadow-float);
  color: var(--sign-ink);
  text-align: center;
`;

const Title = styled.h2`
  font-size: 19px;
  font-weight: 750;
  letter-spacing: -0.02em;
  margin-bottom: 14px;
`;

const Message = styled.div<{ type?: 'success' | 'error' | 'info' }>`
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 4px;
  color: ${({ type }) =>
    type === 'error' ? 'var(--sign-bad-ink)' : 'var(--sign-busy-ink)'};
  background: ${({ type }) =>
    type === 'error' ? 'var(--sign-bad-bg)' : 'var(--sign-busy-bg)'};
`;

const Pill = styled.button<{ $primary?: boolean }>`
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  background: ${({ $primary }) =>
    $primary ? 'var(--sign-primary)' : 'var(--sign-solid)'};
  color: ${({ $primary }) =>
    $primary ? 'var(--sign-on-primary)' : 'var(--sign-ink)'};
  box-shadow: ${({ $primary }) =>
    $primary
      ? 'var(--sign-primary-shadow)'
      : 'inset 0 0 0 1px var(--sign-line-strong)'};

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const ASK_COPY =
  'You were invited to a Mero Sign workspace. Joining adds your node to it, ' +
  'and its agreements sync to you.';

const STAGE_COPY: Record<RedeemStage, { title: string; body: string }> = {
  joining: {
    title: 'Joining the workspace…',
    body: 'Asking your node to accept the invitation.',
  },
  entering: {
    title: 'Opening the agreement…',
    body: 'An invitation is to a workspace; this is finding the agreement inside it.',
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
  gap: 10px;
  margin-top: 18px;
`;

interface InvitationHandlerPopupProps {
  /** The token the shared capture took out of the opened link. */
  invitation: string;
  /**
   * ⚠️ `contextId` IS NULLABLE. An invitation grants membership of a workspace,
   * and a workspace with no agreement yet — or with several — resolves to no
   * single agreement to open. That is a success, not an error, and the caller
   * routes to the workspace instead.
   */
  onSuccess: (agreement: {
    contextId: string | null;
    namespaceId: string | null;
    name: string;
  }) => void;
  /**
   * The node refused the invitation for good (expired, invalid, refused): it is
   * finished with, so the caller acks it now rather than on dismiss.
   */
  onFinalFailure: () => void;
  /**
   * Declined or dismissed. `retain` is true after a failure worth another attempt on a
   * later load (nobody online to let them in, node unreachable), so the caller
   * keeps the invitation instead of acking it.
   */
  onError: (retain: boolean) => void;
}

export default function InvitationHandlerPopup({
  invitation,
  onSuccess,
  onFinalFailure,
  onError,
}: InvitationHandlerPopupProps) {
  const { app } = useCalimero();
  // Null until the person says yes; then the join's progress.
  const [stage, setStage] = useState<RedeemStage | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  // Whether "Try again" can do anything. False once the node has refused the
  // invitation itself — a new link is the only way forward then.
  const [retryable, setRetryable] = useState(true);
  const [retain, setRetain] = useState(false);
  const attempted = useRef(false);

  // The invitation's own name, so the prompt can say WHAT you are joining.
  // Untrusted — it is outside the signature — and superseded by the contract's
  // name the moment the join completes.
  const parsed = parseInvitation(invitation);
  const previewName = parsed?.contextName || parsed?.workspaceName;

  const run = useCallback(async () => {
    if (attempted.current) return;
    attempted.current = true;
    setErrorMessage('');
    setStage('joining');

    try {
      const result = await joinWorkspaceFromInvitation(
        invitation,
        app,
        setStage,
      );
      onSuccess({
        contextId: result.contextId,
        namespaceId: result.namespaceId,
        name: result.name || result.workspaceName,
      });
    } catch (error) {
      attempted.current = false;
      const outcome =
        error instanceof InvitationRedeemError ? error.outcome : null;
      setRetryable(outcome ? outcome.retryable : true);
      setRetain(outcome ? shouldRetain(outcome) : false);
      if (outcome && !shouldRetain(outcome)) onFinalFailure();
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while joining.',
      );
    }
  }, [app, invitation, onSuccess, onFinalFailure]);

  if (errorMessage) {
    return (
      <Overlay>
        <PopupContainer>
          <Title>Could not join</Title>
          <Message type="error" data-testid="invite-error">
            {errorMessage}
          </Message>
          <ButtonGroup>
            <Pill type="button" onClick={() => onError(retain)}>
              Cancel
            </Pill>
            {retryable && (
              <Pill
                type="button"
                $primary
                onClick={() => void run()}
                data-testid="invite-retry"
              >
                Try again
              </Pill>
            )}
          </ButtonGroup>
        </PopupContainer>
      </Overlay>
    );
  }

  if (stage === null) {
    return (
      <Overlay>
        <PopupContainer role="dialog" aria-modal="true">
          <Title>
            {previewName ? `Join “${previewName}”?` : 'Join this workspace?'}
          </Title>
          <Message type="info">{ASK_COPY}</Message>
          <ButtonGroup>
            <Pill
              type="button"
              onClick={() => onError(false)}
              data-testid="invite-decline"
            >
              Not now
            </Pill>
            <Pill
              type="button"
              $primary
              // `app` is created asynchronously by the provider; joining
              // without it puts every call on the apiClient fallback path.
              disabled={!app}
              onClick={() => void run()}
              data-testid="invite-accept"
            >
              Join
            </Pill>
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
