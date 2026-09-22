import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { decodeInvite, type PassInvitePayload } from '../lib/inviteCodec';
import {
  onInvitation,
  type CapturedInvitation,
} from "@calimero-apps/invite";
import { useRedeemInvitation } from '../hooks/useRedeemInvitation';
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
 * Joining is a state change: it puts you in someone else's team and gives them
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
  const [pending, setPending] = useState<{
    captured: CapturedInvitation;
    payload: PassInvitePayload;
  } | null>(null);
  // Shared with the paste field on the teams screen. It also owns WHERE a
  // redeemed invitation lands, which is what this component used to get wrong:
  // it navigated to `/team/<id>`, singular, a path with no route. See
  // `lib/redeemFlow`.
  const { busy, status, error, setError, redeem } = useRedeemInvitation();

  useEffect(
    () =>
      onInvitation((captured) => {
        const payload = decodeInvite(captured.token);
        if (!payload) {
          setError('That invitation could not be read. Ask for a new link.');
          // Acked anyway: a payload that will not decode now will not decode
          // later either, and leaving it unacked replays the error every load.
          captured.resolve();
          return;
        }
        setPending({ captured, payload });
      }),
    // `setError` is a `useState` setter and therefore stable, but it now
    // arrives through a custom hook, where the linter cannot see that. Listed
    // rather than silenced: re-subscribing on a value that never changes costs
    // nothing, and a disable comment here would also hide a real dependency
    // added later.
    [setError],
  );

  const accept = useCallback(async () => {
    if (!pending) return;
    const { captured, payload } = pending;
    // ⚠️ Acked only once the redeem actually SUCCEEDED. Acking first would drop
    // the invitation on a transient failure (no online member yet, a flaky
    // node), and the platform store exists precisely so it survives to be
    // retried on the next load. `redeem` reports false rather than throwing
    // for exactly this decision.
    if (await redeem(payload)) {
      captured.resolve();
      setPending(null);
    }
  }, [pending, redeem]);

  const decline = useCallback(() => {
    pending?.captured.resolve();
    setPending(null);
    setError(null);
  }, [pending, setError]);

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
    pending.payload.vaultName ?? pending.payload.groupAlias ?? 'a team';

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
                ? 'Joining gives you this vault and the rest of the team it belongs to.'
                : 'Joining gives you access to the team and every vault in it.')}
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
