import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero, useContexts } from "@calimero-network/mero-react";
import { getApplicationId, setActiveRoom } from "../lib/session";
import styles from "./RoomsPage.module.css";

/**
 * Room picker / creator — shown when the desktop opened Mero Meet without a
 * specific room (no `context_id` in the hash). A "room" is a Calimero context,
 * which lives inside a namespace. Creating one mirrors the proven setup
 * sequence (see workflows/e2e.yml): create namespace → set member capabilities
 * → create the context, then enter it.
 *
 * Entering an existing room resolves our owned member identity for that context
 * (`identities-owned`) so the lobby/call can execute contract methods as us.
 */
export default function RoomsPage() {
  const navigate = useNavigate();
  const { mero, applicationId: providerAppId } = useMero();
  const appId = getApplicationId() ?? providerAppId ?? "";

  const { contexts, loading: listing, error: listError, refetch } = useContexts(appId || null);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (listError) setError(listError.message);
  }, [listError]);

  const enterRoom = useCallback(
    async (contextId: string) => {
      if (!mero) return;
      setBusy(true);
      setError(null);
      try {
        const owned = await mero.admin.getContextIdentitiesOwned(contextId);
        const identity = owned.identities?.[0];
        if (!identity) {
          throw new Error("You have no member identity in this room yet.");
        }
        setActiveRoom(contextId, identity);
        navigate("/lobby");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open the room.");
      } finally {
        setBusy(false);
      }
    },
    [mero, navigate],
  );

  const createRoom = useCallback(async () => {
    const roomName = name.trim();
    if (!roomName || !mero) return;
    if (!appId) {
      setError("Missing application id — reopen Mero Meet from the desktop app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Namespace to hold the room.
      const ns = await mero.admin.createNamespace({
        applicationId: appId,
        upgradePolicy: "LazyOnAccess",
        name: roomName,
      });
      // 2. Let members do everything in this namespace (15 = all base caps).
      await mero.admin
        .setDefaultCapabilities(ns.namespaceId, { defaultCapabilities: 15 })
        .catch(() => {/* non-fatal: creator already has full caps */});
      // 3. The room context. init(name) → JSON, as bytes (see contract `init`).
      const initializationParams = Array.from(
        new TextEncoder().encode(JSON.stringify({ name: roomName })),
      );
      const ctx = await mero.admin.createContext({
        applicationId: appId,
        groupId: ns.namespaceId,
        initializationParams,
      });
      setActiveRoom(ctx.contextId, ctx.memberPublicKey);
      setName("");
      navigate("/lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room.");
      void refetch();
    } finally {
      setBusy(false);
    }
  }, [name, mero, appId, navigate, refetch]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mero Meet</h1>
        <p className={styles.subtitle}>Pick a room to join, or start a new one.</p>
      </header>

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="New room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createRoom()}
          maxLength={60}
          disabled={busy}
        />
        <button className={styles.createBtn} onClick={createRoom} disabled={busy || !name.trim()}>
          {busy ? "Working…" : "Create room"}
        </button>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>Your rooms</h2>
        {listing && <p className={styles.muted}>Loading rooms…</p>}
        {!listing && contexts.length === 0 && (
          <p className={styles.muted}>No rooms yet. Create one above to get started.</p>
        )}
        {contexts.map((c) => (
          <button
            key={c.contextId}
            className={styles.row}
            onClick={() => enterRoom(c.contextId)}
            disabled={busy}
          >
            <span className={styles.roomAvatar}>{c.contextId.slice(0, 2).toUpperCase()}</span>
            <span className={styles.roomId}>{c.contextId.slice(0, 12)}…</span>
            <span className={styles.enter}>Enter →</span>
          </button>
        ))}
      </section>
    </div>
  );
}
