import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeError } from "@calimero-apps/connect";
import { useConn } from "../hooks/useConn";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { setActiveRoom } from "../lib/session";
import { dropInvite, pendingInvite, type PendingInvite } from "../lib/streams";
import { UserPlusIcon, XIcon } from "./icons";
import styles from "./InviteModal.module.css";

/**
 * "Join X?" for an invitation link that was opened (captured off the URL by
 * `captureInvite` before the app rendered, and kept through the sign-in).
 *
 * Mounted at the app level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's stream and, for a room
 * link, into a live call. v1 redeemed a namespace invitation and then joined
 * the room's context; here it is one org invitation (`redeemInvite`), after
 * which every room of the stream is reachable.
 */
export default function InvitationPrompt() {
  const conn = useConn();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement | null>(null);
  const open = !!conn && !!invite;
  useDialogOpen(ref, open);

  const dismiss = () => {
    dropInvite();
    setInvite(null);
  };

  const join = async () => {
    if (!conn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      await conn.client.redeemInvite(invite.token);
      conn.after();
      dropInvite();
      setInvite(null);
      if (invite.room) {
        setActiveRoom(invite.room, invite.stream);
        navigate("/live");
      } else if (invite.stream) {
        navigate(`/streams/${invite.stream}`);
      } else {
        navigate("/streams");
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={dismiss}
      data-testid="invitation-prompt"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <span className={styles.headIcon} aria-hidden="true">
            <UserPlusIcon size={18} />
          </span>
          <h2 className={styles.title}>
            Join {invite?.name ? `“${invite.name}”` : "this stream"}?
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={dismiss}
            aria-label="Not now"
          >
            <XIcon size={18} />
          </button>
        </header>
        <p className={styles.scope}>
          {invite?.room
            ? "Joining takes you straight into that call."
            : "Joining gives you access to the stream and every room in it."}
        </p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void join()}
          disabled={busy}
          data-testid="invitation-join"
        >
          {busy ? "Joining…" : "Join"}
        </button>
        {error && (
          <p className={styles.hint} role="alert" data-testid="invitation-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
