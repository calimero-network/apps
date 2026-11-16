import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeError, isSpentInvite } from "@calimero-apps/connect";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { lastUsedName } from "@calimero-apps/names";
import { useConn } from "../hooks/useConn";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { useSessionApi } from "../session";
import { setActiveRoom, storedName } from "../lib/session";
import {
  PRODUCT_NAME,
  dropInvite,
  pendingInvite,
  publishMyName,
  streamInfo,
  type PendingInvite,
} from "../lib/streams";
import { UserPlusIcon } from "./icons";
import styles from "./InvitationPrompt.module.css";

/**
 * "Join X?" for an invitation link that was opened (captured off the URL by
 * `captureInvite` before the app rendered, and kept through the sign-in).
 *
 * Mounted at the app level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's stream and, for a room
 * link, into a live call. The shared dialog redeems the one org invitation
 * (through the node's consent page for a session bound to the app), after
 * which every room of the stream is reachable.
 *
 * A sign-up from the invitation page already joined with the invite
 * (`api.joinedInvite`): the token is dropped and what it names opened, with
 * nothing asked and nothing redeemed again.
 *
 * Someone already in the stream (the inviter opening their own link) is told
 * so by the shared dialog, which redeems nothing; continuing opens what the
 * link names like a join does.
 *
 * Once joined, a stream that has no name for you asks for one here, once:
 * every room in it then joins you with it, without asking.
 */
export default function InvitationPrompt() {
  const conn = useConn();
  const joinedInvite = useSessionApi().joinedInvite ?? null;
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() =>
    pendingInvite(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An invite the sign-up joined with: opened, never asked about.
  const [joinedAtSignUp, setJoinedAtSignUp] = useState<PendingInvite | null>(
    null,
  );
  // Joined, and asking for your name in the stream before opening it.
  const [naming, setNaming] = useState<string | null>(null);
  const [selfName, setSelfName] = useState("");
  const ref = useRef<HTMLDialogElement | null>(null);
  const client = conn?.client ?? null;
  // The shared dialog asks to join; this one only asks for your name.
  const open = naming !== null;
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

  /** Joined `org`: asks for your name in the stream when it has none for you, else opens what the link names. */
  const joined = async (org: string) => {
    if (!conn || !invite) return;
    conn.after();
    dropInvite();
    const known = await streamInfo(conn.client, org)
      .then((info) => info.names[conn.accountId] ?? "")
      .catch(() => "");
    if (!known) {
      setSelfName(lastUsedName() || storedName());
      setNaming(org);
      return;
    }
    setInvite(null);
    go(invite);
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

  if (conn && invite && !open) {
    return (
      <AcceptInviteDialog
        client={conn.client}
        passkey={conn.passkey()}
        open
        token={invite.token}
        org={invite.stream ?? undefined}
        appName={PRODUCT_NAME}
        labels={{
          noun: "stream",
          title: `Join ${invite.name ? `\u201c${invite.name}\u201d` : "this stream"}?`,
          body: invite.room
            ? "Joining takes you straight into that call."
            : "Joining gives you access to the stream and every room in it.",
        }}
        onClose={dismiss}
        onError={(e) => {
          if (isSpentInvite(e)) dropInvite();
        }}
        onJoined={({ org }) => void joined(org)}
      />
    );
  }
  if (!naming) return null;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={() => {
        if (!busy) finish();
      }}
      data-testid="invitation-prompt"
    >
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
    </dialog>
  );
}

/** The invitation to ask about once there is a session: the one already held, or the stored one. */
function reread(prev: PendingInvite | null): PendingInvite | null {
  return prev ?? pendingInvite();
}
