import React, { useCallback, useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { C } from '../theme';
import { decodeInvite, type SheetsInvitePayload } from '../lib/inviteCodec';
import { onInvitation, type CapturedInvitation } from '../lib/invitationIntents';
import { acceptInvite } from '../lib/workspaces';

/**
 * "You have been invited to X" — for an invitation that arrived as a link.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. mero-sheets bounces an authenticated visitor
 * from `/` straight to `/mero-sheets`, and an unauthenticated one through the
 * whole login redirect, so an effect that read `location.href` on one route
 * would miss the invitation in both of the two cases that actually happen. The
 * platform store buffers the intent until something asks for it, and this is
 * mounted where it always will.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone else's workspace. Doing that
 * on page load makes a forwarded link, or a background tab that refreshes, join
 * silently. Decoding is pure and local, so the scope can be shown first and the
 * join needs a click.
 *
 * ── Why both buttons ack ─────────────────────────────────────────────────────
 *
 * The platform store keeps an intent until the app says it is handled. "Not now"
 * IS handled — without the ack the same prompt returns on every load, which
 * reads as the app nagging rather than as durability.
 */
export default function InvitationPrompt({
  onJoined,
}: {
  /**
   * Called once a join lands, with whatever the code asked us to open. The
   * workspace state lives in `useWorkspace` on the app page, so the prompt
   * reports rather than navigates.
   */
  onJoined: (landed: { namespaceId: string | null; contextId: string | null }) => void;
}) {
  const { mero } = useMero();
  const [pending, setPending] = useState<{
    captured: CapturedInvitation;
    payload: SheetsInvitePayload;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onInvitation((captured) => {
        const payload = decodeInvite(captured.code);
        if (!payload) {
          setError('That invitation could not be read. Ask for a new link.');
          // Acked anyway: a payload that will not decode now will not decode
          // later either, and leaving it unacked replays the error every load.
          captured.resolve();
          return;
        }
        setPending({ captured, payload });
      }),
    [],
  );

  const accept = useCallback(async () => {
    if (!pending || !mero) return;
    const { captured, payload } = pending;
    setBusy(true);
    setError(null);
    try {
      const landed = await acceptInvite(mero.admin, payload, setStatus);
      // Acked only once the join actually returned. Acking first would drop the
      // invitation on a transient network failure, leaving nothing to retry with.
      captured.resolve();
      setPending(null);
      onJoined({ namespaceId: landed.namespaceId, contextId: landed.contextId });
    } catch (e) {
      // NOT acked: a failure here is usually transient (no online member yet, a
      // flaky node), and the store exists precisely so the invitation survives
      // to be retried on the next load.
      setError(e instanceof Error ? e.message : 'Could not accept the invitation.');
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [pending, mero, onJoined]);

  const decline = useCallback(() => {
    pending?.captured.resolve();
    setPending(null);
    setError(null);
  }, [pending]);

  if (!pending) {
    // An undecodable invitation still deserves to be reported, even though there
    // is nothing to accept.
    return error ? (
      <Wrap>
        <Prompt $bad>
          <Text>{error}</Text>
          <Ghost onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </Ghost>
        </Prompt>
      </Wrap>
    ) : null;
  }

  const name = pending.payload.groupAlias ?? 'a mero-sheets workspace';

  return (
    <Wrap>
      <Prompt data-testid="invite-prompt">
        <Text>
          <strong>You have been invited to {name}</strong>
          <Sub>
            {status ??
              error ??
              (pending.payload.projectName
                ? `Joining opens “${pending.payload.projectName}” and every other spreadsheet in it.`
                : 'Joining gives you every spreadsheet in this workspace.')}
          </Sub>
        </Text>
        <Accept
          onClick={() => void accept()}
          disabled={busy || !mero}
          data-testid="invite-accept"
        >
          {busy ? 'Joining…' : 'Join'}
        </Accept>
        <Ghost onClick={decline} disabled={busy} data-testid="invite-decline">
          Not now
        </Ghost>
      </Prompt>
    </Wrap>
  );
}

const slideIn = keyframes`from{opacity:0;transform:translateY(-12px);}to{opacity:1;transform:none;}`;

const Wrap = styled.div`
  position: fixed; top: 0; left: 0; right: 0; z-index: 200;
  display: flex; justify-content: center; padding: 12px 16px;
  pointer-events: none;
`;

const Prompt = styled.div<{ $bad?: boolean }>`
  pointer-events: auto;
  display: flex; align-items: center; gap: 14px;
  max-width: 720px; width: 100%;
  padding: 12px 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: ${C.paper}; border-radius: 14px;
  border: 1px solid ${(p) => (p.$bad ? C.danger : C.green)};
  box-shadow: 0 20px 50px -24px rgba(14,20,15,0.6);
  animation: ${slideIn} 0.2s cubic-bezier(0.22,1,0.36,1) both;
`;

const Text = styled.span`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
  font-size: 13.5px; color: ${C.ink};
  strong { font-weight: 700; }
`;

const Sub = styled.span`font-size: 12.5px; color: ${C.muted};`;

const Accept = styled.button`
  flex-shrink: 0; padding: 9px 18px;
  font-size: 13px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  &:hover:not(:disabled) { background: ${C.greenHover}; }
  &:disabled { opacity: 0.6; cursor: default; }
`;

const Ghost = styled.button`
  flex-shrink: 0; padding: 9px 14px;
  font-size: 13px; font-weight: 500; border-radius: 10px; cursor: pointer;
  color: ${C.muted}; background: transparent; border: 1px solid ${C.line};
  &:hover:not(:disabled) { background: ${C.paper2}; color: ${C.ink}; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
