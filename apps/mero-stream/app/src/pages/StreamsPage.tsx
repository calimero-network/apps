import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { getApplicationId, setActiveRoom, setRoomName } from "../lib/session";
import { decodeInvite } from "../lib/inviteCodec";
import {
  acceptInvite,
  createStreamNamespace,
  enterRoomContext,
  listStreamNamespaces,
  mintNamespaceInvite,
  type NamespaceRow,
} from "../lib/groups";
import { ActionButton, InviteBox, StatusNote, Spinner } from "../components/ui";
import styles from "./StreamsPage.module.css";

/**
 * Streams = NAMESPACES. One level up from where this page used to sit.
 *
 * It used to list contexts and call each one a "stream", which collapsed two
 * distinct things into one and left no room for rooms: creating a stream made a
 * namespace plus a context and nothing could ever add a second call to it. The
 * model that actually matches Calimero, and what the two-node suite proves:
 *
 *   Namespace ("stream")  ← you invite people HERE
 *     └── Subgroup ("room") + Context   ← one video call   → /streams/:id
 *
 * So: this page creates namespaces, invites to namespaces, and accepts any invite
 * code. Rooms live on RoomsPage.
 *
 * Invite codes are the SAME format mero-chat and mero-blocks use — one base58
 * token of deflated JSON (lib/inviteCodec) — so a code minted by any of them
 * decodes here, and a code from here pastes into a chat window without being
 * mangled.
 */
export default function StreamsPage() {
  const navigate = useNavigate();
  const { mero, applicationId: providerAppId } = useMero();
  const appId = getApplicationId() ?? providerAppId ?? "";

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // One key names the action in flight ("create", "join", `invite:<id>`), instead
  // of a single `busy` boolean. With a boolean, clicking Invite disabled Create,
  // Join and every row, and all of them read "Working…" — indistinguishable from
  // the page having locked up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  /**
   * Run one action under its own key, with step status wired to `onStatus`.
   * Clears the previous outcome first: leaving a stale "Joined ✓" above a fresh
   * spinner reads as if the new action had already finished.
   */
  const run = useCallback(
    async (
      key: string,
      fn: (onStatus: (m: string) => void) => Promise<void>,
    ) => {
      setPending(key);
      setError(null);
      setDone(null);
      setStatus(null);
      try {
        await fn(setStatus);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(null);
        setStatus(null);
      }
    },
    [],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (!mero || !appId) {
        setListing(false);
        return;
      }
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listStreamNamespaces(mero.admin, appId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load streams.");
      } finally {
        setListing(false);
      }
    },
    [mero, appId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(() => {
    const streamName = name.trim();
    if (!streamName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Stream from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { namespaceId } = await createStreamNamespace(
        mero.admin,
        { applicationId: appId, name: streamName },
        onStatus,
      );
      setName("");
      onStatus("Refreshing your streams…");
      await load(false);
      // Straight into the new namespace: it has no rooms yet, and making one is
      // the only useful next step.
      navigate(`/streams/${namespaceId}`);
    });
  }, [name, mero, appId, run, load, navigate]);

  const mintInvite = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      void run(`invite:${ns.namespaceId}`, async (onStatus) => {
        const code = await mintNamespaceInvite(
          mero.admin,
          { namespaceId: ns.namespaceId, namespaceName: ns.name },
          onStatus,
        );
        setInvite({ id: ns.namespaceId, code });
        setCopied(false);
        setDone(`Invite code ready for “${ns.name}”.`);
      });
    },
    [mero, run],
  );

  /**
   * Accept any code: a namespace invite, or a room invite (which carries the
   * namespace invitation too, so someone with no prior membership gets both joins
   * from one paste). A room code that names its context takes you into the call.
   */
  const join = useCallback(() => {
    if (!mero) return;
    const payload = decodeInvite(joinCode);
    if (!payload) {
      setError(
        "That invite code is not valid. Paste the whole code — it is one long line with no spaces.",
      );
      return;
    }
    void run("join", async (onStatus) => {
      const accepted = await acceptInvite(mero.admin, payload, onStatus);
      setJoinCode("");
      onStatus("Refreshing your streams…");
      await load(false);

      if (accepted.roomId && accepted.contextId) {
        const identity = await enterRoomContext(
          mero.admin,
          { roomId: accepted.roomId, contextId: accepted.contextId },
          onStatus,
        );
        if (accepted.roomName)
          setRoomName(accepted.contextId, accepted.roomName);
        setActiveRoom(accepted.contextId, identity);
        navigate("/live");
        return;
      }
      if (accepted.namespaceId) {
        navigate(`/streams/${accepted.namespaceId}`);
        return;
      }
      setDone("Joined. Your streams are listed below.");
    });
  }, [mero, joinCode, run, load, navigate]);

  const copy = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, permissions). The code
      // is in a selectable input, so say that instead of failing silently.
      setError("Could not reach the clipboard — select the code and copy it.");
    }
  }, [invite]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Mero Stream <span className={styles.version}>v{__APP_VERSION__}</span>
        </h1>
        <p className={styles.subtitle}>
          A <strong>stream</strong> is a namespace you invite people to. Inside
          it, each <strong>room</strong> is one video call. This is a Task-3
          capacity probe — media rides the contract, not WebRTC.
        </p>
      </header>

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="New stream name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          maxLength={60}
          disabled={pending === "create"}
          data-testid="stream-name-input"
        />
        <ActionButton
          onClick={create}
          pending={pending === "create"}
          pendingLabel="Creating…"
          disabled={!name.trim() || !mero}
          testId="create-stream"
        >
          Create stream
        </ActionButton>
      </section>

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="Paste an invite code — for a stream or a room"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join()}
          disabled={pending === "join"}
          data-testid="join-code-input"
        />
        <ActionButton
          onClick={join}
          pending={pending === "join"}
          pendingLabel="Joining…"
          disabled={!joinCode.trim() || !mero}
          testId="join-submit"
        >
          Join
        </ActionButton>
      </section>

      {/* Step-level status: these flows are 3-6 round-trips deep, and naming the
          step is what separates "loading" from "hung". */}
      {status && (
        <StatusNote tone="pending" testId="streams-status">
          {status}
        </StatusNote>
      )}
      {!status && done && (
        <StatusNote tone="ok" testId="streams-done">
          {done}
        </StatusNote>
      )}
      {error && (
        <StatusNote tone="error" testId="streams-error">
          {error}
        </StatusNote>
      )}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>
          Your streams
          {listing && (
            <span className={styles.listLoading}>
              <Spinner label="Loading streams" /> loading…
            </span>
          )}
        </h2>

        {!listing && namespaces.length === 0 && (
          <p className={styles.muted}>
            No streams yet. Create one above, or paste an invite code to join
            someone else&apos;s.
          </p>
        )}

        {namespaces.map((ns) => (
          <div key={ns.namespaceId}>
            <div className={styles.rowWrap}>
              <button
                className={styles.row}
                onClick={() => navigate(`/streams/${ns.namespaceId}`)}
                data-testid="stream-row"
                data-namespace={ns.namespaceId}
              >
                <span className={styles.streamAvatar}>
                  {ns.name.slice(0, 2).toUpperCase()}
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{ns.name}</span>
                  <span className={styles.rowMeta}>
                    {ns.roomCount} room{ns.roomCount === 1 ? "" : "s"} ·{" "}
                    {ns.memberCount} member{ns.memberCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className={styles.enter}>Open →</span>
              </button>
              {/* Outside the row <button> on purpose: nested interactive elements
                  are invalid HTML and the inner click does not reliably fire. */}
              <ActionButton
                onClick={() => mintInvite(ns)}
                pending={pending === `invite:${ns.namespaceId}`}
                pendingLabel="Minting…"
                variant="secondary"
                testId="invite-btn"
                title="Mint a code that invites someone to this whole stream"
              >
                Invite
              </ActionButton>
            </div>

            {invite?.id === ns.namespaceId && (
              <InviteBox
                code={invite.code}
                scope={`Whole stream · ${ns.name}`}
                copied={copied}
                onCopy={() => void copy()}
                hint={
                  <>
                    Anyone with this code can join <strong>{ns.name}</strong>{" "}
                    and every room in it. They paste it into{" "}
                    <em>Paste an invite code</em> above and land on the room
                    list. To drop someone straight into one call, open the
                    stream and use <strong>Invite</strong> on that room.
                  </>
                }
              />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
