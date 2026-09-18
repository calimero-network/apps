import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { redeemInvite } from '../lib/vaults';
import { decodeInvite, type PassInvitePayload } from '../lib/inviteCodec';
import {
  onInvitation,
  type CapturedInvitation,
} from '../lib/invitationIntents';
import styles from './InvitationPrompt.module.css';

/**
 * "You have been invited to X" — for an invitation that arrived as a link.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. Mero Pass has a marketing landing page on
 * `/`, a redirect on `/login`, a home page and a vault page, and the desktop
 * launcher can append `?invitation=…` to whichever of them it was given. A
 * prompt that lives on one route is a prompt that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone else's space and gives them
 * a peer that syncs their secrets. Doing that on page load makes a forwarded
 * link, or a background tab that refreshes, join silently. Decoding is pure and
 * local, so the scope can be shown first and the join needs a click.
 *
 * ── Why both buttons ack ─────────────────────────────────────────────────────
 *
 * The platform store keeps an intent until the app says it is handled. "Not
 * now" IS handled — without the ack the same prompt returns on every load,
 * which reads as the app nagging rather than as durability.
 */
export default function InvitationPrompt() {
  const { mero } = useMero();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{
    captured: CapturedInvitation;
    payload: PassInvitePayload;
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
      const landed = await redeemInvite(mero.admin, payload, setStatus);
      // Acked only once the redeem actually returned. Acking first would drop
      // the invitation on a transient network failure, leaving nothing to retry
      // with.
      captured.resolve();
      setPending(null);
      if (landed.kind === 'vault') {
        navigate(`/vault/${landed.contextId}`);
      } else if (landed.kind === 'space') {
        navigate(`/space/${landed.namespaceId}`);
      } else {
        navigate('/home');
      }
    } catch (e) {
      // NOT acked: a failure here is usually transient (no online member yet, a
      // flaky node), and the store exists precisely so the invitation survives
      // to be retried on the next load.
      setError(e instanceof Error ? e.message : 'Could not accept the invite.');
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [pending, mero, navigate]);

  const decline = useCallback(() => {
    pending?.captured.resolve();
    setPending(null);
    setError(null);
  }, [pending]);

  if (!pending) {
    // An undecodable invitation still deserves to be reported, even though
    // there is nothing to accept.
    return error ? (
      <div className={styles.wrap}>
        <div className={`${styles.prompt} ${styles.promptError}`}>
          <span className={styles.text}>{error}</span>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    ) : null;
  }

  const name =
    pending.payload.vaultName ?? pending.payload.groupAlias ?? 'a space';

  return (
    <div className={styles.wrap}>
      <div className={styles.prompt} data-testid="invite-prompt">
        <span className={styles.text}>
          <strong>You have been invited to {name}</strong>
          <span className={styles.sub}>
            {status ??
              error ??
              // Deliberately explicit about the real grant. A vault invitation
              // is a SPACE invitation underneath, because vault access is
              // inherited, and the person being asked to accept is entitled to
              // know that before they click.
              (pending.payload.vaultName
                ? 'Joining gives you this vault and the rest of the space it belongs to.'
                : 'Joining gives you access to the space and every vault in it.')}
          </span>
        </span>
        <button
          type="button"
          className={styles.accept}
          onClick={() => void accept()}
          disabled={busy || !mero}
          data-testid="invite-accept"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
        <button
          type="button"
          className={styles.ghost}
          onClick={decline}
          disabled={busy}
          data-testid="invite-decline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
