import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeError, describeRedeemFailure } from "@calimero-apps/connect";
import { lastUsedName } from "@calimero-apps/names";
import { useConn } from "../hooks/useConn";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { useSessionApi } from "../session";
import { setActiveRoom, storedName } from "../lib/session";
import {
  INVITE_REFUSED,
  alreadyMember,
  dropInvite,
  inviteRefused,
  pendingInvite,
  publishMyName,
  streamInfo,
  type PendingInvite,
} from "../lib/streams";
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
 *
 * A sign-up from the invitation page already joined with the invite
 * (`api.joinedInvite`): the token is dropped and what it names opened, with
 * nothing asked and nothing redeemed again.
 *
 * Someone already in the stream (the inviter opening their own link) is told
 * so and the token dropped: redeeming it would spend its single use, and the
 * person it was meant for could no longer join. A refused invite (unknown,
 * used, expired, revoked) is said plainly.
 *
 * Once joined, a stream that has no name for you asks for one here, once:
 * every room in it then joins you with it, without asking.
 */
export default function InvitationPrompt() {
  const conn = useConn();
  const joinedInvite = useSessionApi().joinedInvite ?? null;
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // `null` until the membership check answers; `false` too when it cannot.
  const [member, setMember] = useState<boolean | null>(null);
  // An invite the sign-up joined with: opened, never asked about.
  const [joinedAtSignUp, setJoinedAtSignUp] = useState<PendingInvite | null>(null);
  // Joined, and asking for your name in the stream before opening it.
  const [naming, setNaming] = useState<string | null>(null);
  const [selfName, setSelfName] = useState("");
  const ref = useRef<HTMLDialogElement | null>(null);
  const client = conn?.client ?? null;
  const open = !!client && !!invite && member !== null;
  useDialogOpen(ref, open);

  // Signing in on the invitation page leaves the token where it was: re-read it.
  // Signing up there joined with it already: open what it named, ask nothing.
  useEffect(() => {
    if (!client) return;
    const next = reread(invite);
    if (next && next.token === joinedInvite) {
      dropInvite();
      setInvite(null);
      setJoinedAtSignUp(next);
      return;
    }
    setInvite(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per session; `joinedInvite` is set before it signs in
  }, [client]);

  useEffect(() => {
    if (!client || !invite || invite.token === joinedInvite) return undefined;
    let live = true;
    setMember(null);
    void alreadyMember(client, invite).then((known) => {
      if (!live) return;
      if (known) dropInvite();
      setMember(known ?? false);
    });
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per token, not per re-read
  }, [client, invite?.token]);

  const dismiss = () => {
    dropInvite();
    setInvite(null);
  };

  const go = (target: PendingInvite) => {
    if (target.room) {
      setActiveRoom(target.room, target.stream);
      navigate("/live");
    } else if (target.stream) {
      navigate(`/streams/${target.stream}`);
    } else {
      navigate("/streams");
    }
  };

  // Opened one render later: the home route's own redirect into the app runs
  // in the sign-in's render, and would land after this navigation.
  useEffect(() => {
    if (!joinedAtSignUp) return;
    setJoinedAtSignUp(null);
    go(joinedAtSignUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is rebuilt each render; this runs once per joined invite
  }, [joinedAtSignUp]);

  /** Already a member: nothing to redeem, just open what the link names. */
  const openIt = () => {
    if (!invite) return;
    dropInvite();
    setInvite(null);
    go(invite);
  };

  const join = async () => {
    if (!conn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const redeemed = (await conn.client.orgs.inviteRedeem({ token: invite.token })) as {
        org?: unknown;
        orgId?: unknown;
      } | null;
      conn.after();
      dropInvite();
      const org =
        [redeemed?.org, redeemed?.orgId, invite.stream].find(
          (v): v is string => typeof v === "string" && !!v,
        ) ?? null;
      const known = org
        ? await streamInfo(conn.client, org)
            .then((info) => info.names[conn.accountId] ?? "")
            .catch(() => "")
        : "";
      if (org && !known) {
        setSelfName(lastUsedName() || storedName());
        setNaming(org);
        return;
      }
      setInvite(null);
      go(invite);
    } catch (e) {
      // A refusal can never succeed: drop it. Anything else (a lapsed
      // session, a rate limit, the cluster unreachable) is kept for another try.
      if (inviteRefused(e)) {
        dropInvite();
        setRefused(true);
        setError(INVITE_REFUSED);
      } else {
        setError(describeRedeemFailure(e));
      }
    } finally {
      setBusy(false);
    }
  };

  /** Into what the invitation named; a skipped name is asked by the stream's first room. */
  const finish = () => {
    if (!invite) return;
    setNaming(null);
    setInvite(null);
    setError(null);
    go(invite);
  };

  const saveName = async () => {
    if (!conn || !naming || !selfName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await publishMyName(conn.client, naming, conn.accountId, selfName);
      conn.after();
      finish();
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
      onClose={() => {
        if (!naming) dismiss();
        else if (!busy) finish();
      }}
      data-testid="invitation-prompt"
    >
      {naming ? (
        <div className={styles.body} data-testid="invitation-name">
          <header className={styles.head}>
            <span className={styles.headIcon} aria-hidden="true">
              <UserPlusIcon size={18} />
            </span>
            <h2 className={styles.title}>Your name in this stream</h2>
          </header>
          <p className={styles.scope}>
            The name on your tile in every room of the stream. Asked once.
          </p>
          <input
            className={styles.nameInput}
            aria-label="Your name in this stream"
            placeholder="e.g. Ana"
            value={selfName}
            maxLength={40}
            autoFocus
            autoComplete="nickname"
            onChange={(e) => setSelfName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveName()}
            data-testid="invitation-name-input"
          />
          <button
            type="button"
            className={styles.primary}
            onClick={() => void saveName()}
            disabled={busy || !selfName.trim()}
            data-testid="invitation-name-save"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          {error && (
            <p className={styles.hint} role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <header className={styles.head}>
            <span className={styles.headIcon} aria-hidden="true">
              <UserPlusIcon size={18} />
            </span>
            <h2 className={styles.title}>
              {member
                ? "You're already in this stream"
                : `Join ${invite?.name ? `“${invite.name}”` : "this stream"}?`}
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
          <p
            className={styles.scope}
            data-testid={member ? "invitation-member" : undefined}
          >
            {member
              ? "This invitation is for a stream you are already a member of, so there is nothing to join. The link was left unused for whoever it was meant for."
              : invite?.room
                ? "Joining takes you straight into that call."
                : "Joining gives you access to the stream and every room in it."}
          </p>
          {member ? (
            <button
              type="button"
              className={styles.primary}
              onClick={openIt}
              data-testid="invitation-open"
            >
              Open it
            </button>
          ) : (
            !refused && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => void join()}
                disabled={busy}
                data-testid="invitation-join"
              >
                {busy ? "Joining…" : "Join"}
              </button>
            )
          )}
          {error && (
            <p className={styles.hint} role="alert" data-testid="invitation-error">
              {error}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

/**
 * The invitation to ask about once there is a session: the one already held,
 * or the stored one. Never a fresh copy of the one held: that would re-run the
 * membership check and close and reopen the dialog (closing it is "Not now"),
 * and after the check has dropped an already-member's token it would lose the
 * "You're already in" answer before anyone read it.
 */
function reread(prev: PendingInvite | null): PendingInvite | null {
  return prev ?? pendingInvite();
}
