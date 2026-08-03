import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import {
  getApplicationId,
  setActiveRoom,
  getRoomName,
  setRoomName,
} from "../lib/session";
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
 * DEVIATION from mero-meet's RoomsPage: no "join by invite code" flow here — that
 * needs the node's invitation-token parsing (lib/invitation), which is out of
 * scope for a Task-3 probe scaffold. Two-node testing uses the dev harness (each
 * node creates/joins the context out of band). See the report for details.
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
        navigate("/stream");
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
      navigate("/stream");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the stream.");
      void loadStreams();
    } finally {
      setBusy(false);
    }
  }, [name, mero, appId, navigate, loadStreams]);

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

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>Your streams</h2>
        {listing && <p className={styles.muted}>Loading streams…</p>}
        {!listing && streams.length === 0 && (
          <p className={styles.muted}>
            No streams yet. Create one above to get started.
          </p>
        )}
        {streams.map((s) => (
          <button
            key={s.contextId}
            className={styles.row}
            onClick={() => enterStream(s.contextId)}
            disabled={busy}
          >
            <span className={styles.streamAvatar}>
              {s.name.slice(0, 2).toUpperCase()}
            </span>
            <span className={styles.streamId}>{s.name}</span>
            <span className={styles.enter}>Open →</span>
          </button>
        ))}
      </section>
    </div>
  );
}
