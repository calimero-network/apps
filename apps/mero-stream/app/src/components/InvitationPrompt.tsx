import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { redeemInvite } from "../lib/groups";
import { decodeInvite, type StreamInvitePayload } from "../lib/inviteCodec";
import {
  onInvitation,
  type CapturedInvitation,
} from "../lib/invitationIntents";
import { setActiveRoom, setRoomName } from "../lib/session";
import styles from "./InvitationPrompt.module.css";

/**
 * "You have been invited to X" — for an invitation that arrived as a link.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. The first version put this on the streams
 * page, which is wrong in a way that had already bitten once: someone with a
 * stored context is redirected to `/live` on boot, so the streams page never
 * mounts, so the invitation was never shown. That is the same shape as the bug
 * where room links pointed at a route with no redemption code — a handler that
 * only exists on one route is a handler that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone's namespace and, for a room
 * invitation, walks you into a live call. Doing that on page load makes a
 * forwarded link, or a background tab that refreshes, join silently. Decoding is
 * pure and local, so the scope can be shown first and the join needs a click.
 *
 * ── Why both buttons ack ─────────────────────────────────────────────────────
 *
 * The platform store keeps an intent until the app says it is handled. "Not now"
 * IS handled — without the ack the same prompt returns on every load, which reads
 * as the app nagging rather than as durability.
 */
export default function InvitationPrompt() {
  const { mero } = useMero();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{
    captured: CapturedInvitation;
    payload: StreamInvitePayload;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onInvitation((captured) => {
        const payload = decodeInvite(captured.code);
        if (!payload) {
          setError("That invitation could not be read. Ask for a new link.");
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
      // Acked only once the redeem actually returned. Acking first would drop the
      // invitation on a transient network failure, leaving nothing to retry with.
      captured.resolve();
      setPending(null);
      if (landed.kind === "room") {
        if (landed.roomName) setRoomName(landed.contextId, landed.roomName);
        setActiveRoom(landed.contextId, landed.identity);
        navigate("/live");
      } else if (landed.kind === "namespace") {
        navigate(`/streams/${landed.namespaceId}`);
      } else {
        navigate("/streams");
      }
    } catch (e) {
      // NOT acked: a failure here is usually transient (no online member yet, a
      // flaky node), and the store exists precisely so the invitation survives to
      // be retried on the next load.
      setError(e instanceof Error ? e.message : "Could not accept the invite.");
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
    // An undecodable invitation still deserves to be reported, even though there
    // is nothing to accept.
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
    pending.payload.roomName ?? pending.payload.groupAlias ?? "a stream";

  return (
    <div className={styles.wrap}>
      <div className={styles.prompt} data-testid="invite-prompt">
        <span className={styles.text}>
          <strong>You have been invited to {name}</strong>
          <span className={styles.sub}>
            {status ??
              error ??
              (pending.payload.roomName
                ? "Joining takes you straight into that call."
                : "Joining gives you access to the stream and every room in it.")}
          </span>
        </span>
        <button
          type="button"
          className={styles.accept}
          onClick={() => void accept()}
          disabled={busy || !mero}
          data-testid="invite-accept"
        >
          {busy ? "Joining…" : "Join"}
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
