import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import {
  getApplicationId,
  setActiveRoom,
  getRoomName,
  setRoomName,
} from "../lib/session";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
} from "../lib/inviteCodec";
import styles from "./StreamsPage.module.css";

interface StreamEntry {
  contextId: string;
  name: string;
}

/**
 * Stream picker / creator — shown when the desktop opened Mero Stream without a
 * specific stream (no `context_id` in the hash). A "stream" is a Calimero
 * context, living inside a namespace.
 *
 * This is a MINIMAL picker (adapted from mero-meet's RoomsPage): it lists the
 * streams for this app and creates new ones. Creating one mirrors the proven
 * setup sequence: create namespace → set member capabilities → create the
 * context (init(name)), then enter it.
 *
 * Invite / join use the SAME code format as mero-chat and mero-blocks —
 * base58(deflate(JSON)) via lib/inviteCodec — so a code minted by any of them works
 * here. Invitations are OPEN and issued at the NAMESPACE level, so a joiner gets the
 * whole stream rather than one room.
 */
export default function StreamsPage() {
  const navigate = useNavigate();
  const { mero, applicationId: providerAppId } = useMero();
  const appId = getApplicationId() ?? providerAppId ?? "";

  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");

  // Build the stream list: every context for this app, named by its namespace
  // alias (or our locally-cached name), falling back to a short id.
  const loadStreams = useCallback(async () => {
    if (!mero || !appId) {
      setListing(false);
      return;
    }
    try {
      const [ctxResp, namespaces] = await Promise.all([
        mero.admin.getContextsForApplication(appId),
        mero.admin.listNamespacesForApplication(appId).catch(() => []),
      ]);
      const nsName = new Map<string, string>();
      for (const n of namespaces) {
        const nm = (n.name ?? (n as { alias?: string }).alias ?? "").trim();
        if (nm) nsName.set(n.namespaceId, nm);
      }
      const list = (ctxResp.contexts ?? []).map((c) => {
        const cached = getRoomName(c.id);
        const ns = nsName.get(c.groupId ?? "") ?? "";
        return {
          contextId: c.id,
          name: cached || ns || `Stream ${c.id.slice(0, 6)}`,
        };
      });
      setStreams(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load streams.");
    } finally {
      setListing(false);
    }
  }, [mero, appId]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  const enterStream = useCallback(
    async (contextId: string) => {
      if (!mero) return;
      setBusy(true);
      setError(null);
      try {
        const owned = await mero.admin.getContextIdentitiesOwned(contextId);
        const identity = owned.identities?.[0];
        if (!identity) {
          throw new Error("You have no member identity in this stream yet.");
        }
        setActiveRoom(contextId, identity);
        navigate("/live"); // 480p H.264, not the 64x48 comparison route
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open the stream.");
      } finally {
        setBusy(false);
      }
    },
    [mero, navigate],
  );

  const createStream = useCallback(async () => {
    const streamName = name.trim();
    if (!streamName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Stream from the desktop app.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Namespace to hold the stream.
      const ns = await mero.admin.createNamespace({
        applicationId: appId,
        upgradePolicy: "LazyOnAccess",
        name: streamName,
      });
      // 2. Let members do everything in this namespace (15 = all base caps).
      await mero.admin
        .setDefaultCapabilities(ns.namespaceId, { defaultCapabilities: 15 })
        .catch(() => {
          /* non-fatal: creator already has full caps */
        });
      // 2b. Rooms are PUBLIC from the start: `VisibilityMode` defaults to
      //     `restricted`, and a restricted subgroup is unreachable by the very
      //     members you just invited — join-via-inheritance returns 403. The wire
      //     value is lowercase; core rejects "Open".
      await mero.admin
        .setSubgroupVisibility(ns.namespaceId, { subgroupVisibility: "open" })
        .catch(() => {
          /* non-fatal on a namespace root; rooms created under it set their own */
        });
      // 3. The stream context. init(name) → JSON, as bytes (see contract `init`).
      const initializationParams = Array.from(
        new TextEncoder().encode(JSON.stringify({ name: streamName })),
      );
      const ctx = await mero.admin.createContext({
        applicationId: appId,
        groupId: ns.namespaceId,
        initializationParams,
      });
      setRoomName(ctx.contextId, streamName);
      setActiveRoom(ctx.contextId, ctx.memberPublicKey);
      setName("");
      // /live (approach 2, 640x480 H.264), NOT /stream (approach 3, 64x48 toy codec
      // in WASM). This used to navigate to /stream, which is the entire reason the
      // app appeared to be "64x48, not 480p": the 480p route was only reachable by
      // editing the URL by hand — which is exactly what the e2e did, so the suite
      // passed at 480p while the product showed 64x48.
      navigate("/live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the stream.");
      void loadStreams();
    } finally {
      setBusy(false);
    }
  }, [name, mero, appId, navigate, loadStreams]);

  // Mint an OPEN namespace invitation and encode it into one pasteable code.
  // Same wire format as mero-chat and mero-blocks — base58(deflate(JSON)) — so a
  // code from any of them decodes here.
  const invite = useCallback(
    async (contextId: string) => {
      if (!mero) return;
      setBusy(true);
      setError(null);
      setInviteCode(null);
      try {
        // The namespace is the group the CONTEXT belongs to; invite at that level so
        // the joiner gets the whole stream, not one room.
        const group = await mero.admin.getContextGroup(contextId);
        const namespaceId =
          (group as { groupId?: string }).groupId ??
          (group as unknown as string);
        const res = await mero.admin.createNamespaceInvitation(
          String(namespaceId),
          {},
        );
        // An OPEN invitation carries no invitee key: anyone holding the code can
        // join. Deliberately do NOT pass inviteePublicKey — it is silently ignored
        // and misleads the next reader.
        const invitation = (res as { invitation?: unknown }).invitation ?? res;
        setInviteCode(
          encodeInvite({
            invitation: invitation as never,
            groupAlias: streams.find((x) => x.contextId === contextId)?.name,
            contextId,
            groupId: String(namespaceId),
          }),
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not create an invite.",
        );
      } finally {
        setBusy(false);
      }
    },
    [mero, streams],
  );

  // Join from a pasted code. The namespace id is read out of the SIGNED invitation
  // rather than from the wrapper, so a tampered code cannot redirect the join.
  const join = useCallback(async () => {
    if (!mero) return;
    const payload = decodeInvite(joinCode);
    if (!payload) {
      setError("That invite code is not valid.");
      return;
    }
    const namespaceId = namespaceIdOfInvite(payload);
    if (!namespaceId) {
      setError("The invite code carries no namespace id.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mero.admin.joinNamespace(namespaceId, {
        invitation: payload.invitation as never,
      });
      setJoinCode("");
      // Contexts arrive by replication, so the list may lag the join by a moment.
      await loadStreams();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join.");
    } finally {
      setBusy(false);
    }
  }, [mero, joinCode, loadStreams]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Mero Stream <span className={styles.version}>v{__APP_VERSION__}</span>
        </h1>
        <p className={styles.subtitle}>
          Pick a stream context or create one. This is a Task-3 capacity probe —
          media rides the contract, not WebRTC.
        </p>
      </header>

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="New stream name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createStream()}
          maxLength={60}
          disabled={busy}
        />
        <button
          className={styles.createBtn}
          onClick={createStream}
          disabled={busy || !name.trim()}
        >
          {busy ? "Working…" : "Create stream"}
        </button>
      </section>

      {/* Join by invite code. Same format mero-chat and mero-blocks mint. */}
      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="Paste an invite code to join a stream"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void join()}
          disabled={busy}
          data-testid="join-code-input"
        />
        <button
          className={styles.createBtn}
          onClick={() => void join()}
          disabled={busy || !joinCode.trim()}
          data-testid="join-submit"
        >
          {busy ? "Working…" : "Join"}
        </button>
      </section>

      {inviteCode && (
        <section className={styles.createBar}>
          <input
            className={styles.input}
            value={inviteCode}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            data-testid="invite-code"
          />
          <button
            className={styles.createBtn}
            onClick={() => void navigator.clipboard?.writeText(inviteCode)}
            data-testid="invite-copy"
          >
            Copy
          </button>
        </section>
      )}

      {error && (
        <p className={styles.error} data-testid="streams-error">
          {error}
        </p>
      )}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>Your streams</h2>
        {listing && <p className={styles.muted}>Loading streams…</p>}
        {!listing && streams.length === 0 && (
          <p className={styles.muted}>
            No streams yet. Create one above to get started.
          </p>
        )}
        {streams.map((s) => (
          <div key={s.contextId} className={styles.rowWrap}>
            <button
              className={styles.row}
              onClick={() => enterStream(s.contextId)}
              disabled={busy}
              data-testid="stream-row"
            >
              <span className={styles.streamAvatar}>
                {s.name.slice(0, 2).toUpperCase()}
              </span>
              <span className={styles.streamId}>{s.name}</span>
              <span className={styles.enter}>Open →</span>
            </button>
            {/* Outside the row button on purpose: nested interactive elements are
                invalid HTML and the inner click does not reliably fire. */}
            <button
              className={styles.createBtn}
              onClick={() => void invite(s.contextId)}
              disabled={busy}
              data-testid="invite-btn"
              title="Mint an invite code for this stream's namespace"
            >
              Invite
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
