import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { getApplicationId, setActiveRoom, getRoomName, setRoomName } from "../lib/session";
import { parseRoomInvitation } from "../lib/invitation";
import styles from "./RoomsPage.module.css";

interface RoomEntry {
  contextId: string;
  name: string;
}

/**
 * Room picker / creator — shown when the desktop opened Mero Meet without a
 * specific room (no `context_id` in the hash). A "room" is a Calimero context,
 * which lives inside a namespace. Creating one mirrors the proven setup
 * sequence (see workflows/e2e.yml): create namespace → set member capabilities
 * → create the context, then enter it.
 *
 * You can also JOIN a room someone shared: paste their invite code → join the
 * namespace → wait for the room context to sync → join it.
 *
 * Rooms are shown by their human name (namespace alias, or the name we cached on
 * create/join/enter) — never the raw context id.
 */
export default function RoomsPage() {
  const navigate = useNavigate();
  const { mero, applicationId: providerAppId } = useMero();
  const appId = getApplicationId() ?? providerAppId ?? "";

  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the room list: every context for this app, named by its namespace
  // alias (or our locally-cached name), falling back to a short id.
  const loadRooms = useCallback(async () => {
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
        return { contextId: c.id, name: cached || ns || `Room ${c.id.slice(0, 6)}` };
      });
      setRooms(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rooms.");
    } finally {
      setListing(false);
    }
  }, [mero, appId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

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
      setRoomName(ctx.contextId, roomName);
      setActiveRoom(ctx.contextId, ctx.memberPublicKey);
      setName("");
      navigate("/lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the room.");
      void loadRooms();
    } finally {
      setBusy(false);
    }
  }, [name, mero, appId, navigate, loadRooms]);

  const joinByCode = useCallback(async () => {
    const code = joinCode.trim();
    if (!code || !mero) return;
    if (!appId) {
      setError("Missing application id — reopen Mero Meet from the desktop app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { namespaceId, signed, roomName } = parseRoomInvitation(code);
      if (!namespaceId) throw new Error("That doesn't look like a valid invite code.");

      // Join the namespace the room lives in. (`signed` is the node's own
      // invitation struct, decoded from the token — typed loosely here.)
      await mero.admin.joinNamespace(
        namespaceId,
        { invitation: signed } as Parameters<typeof mero.admin.joinNamespace>[1],
      );

      // The room context syncs in after the namespace join — poll for it.
      let contextId = "";
      for (let i = 0; i < 15 && !contextId; i++) {
        const resp = await mero.admin.getContextsForApplication(appId);
        const match = (resp.contexts ?? []).find((c) => (c.groupId ?? "") === namespaceId);
        if (match) contextId = match.id ?? "";
        if (!contextId) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!contextId) {
        throw new Error("Joined the namespace, but the room hasn't synced yet — try again shortly.");
      }

      const joined = await mero.admin.joinContext(contextId);
      if (roomName) setRoomName(contextId, roomName);
      setActiveRoom(contextId, joined.memberPublicKey);
      setJoinCode("");
      navigate("/lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join with that code.");
    } finally {
      setBusy(false);
    }
  }, [joinCode, mero, appId, navigate]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mero Meet</h1>
        <p className={styles.subtitle}>Pick a room, start a new one, or join with an invite.</p>
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

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="Paste an invite code to join"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinByCode()}
          disabled={busy}
        />
        <button className={styles.joinBtn} onClick={joinByCode} disabled={busy || !joinCode.trim()}>
          Join
        </button>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>Your rooms</h2>
        {listing && <p className={styles.muted}>Loading rooms…</p>}
        {!listing && rooms.length === 0 && (
          <p className={styles.muted}>No rooms yet. Create one above to get started.</p>
        )}
        {rooms.map((r) => (
          <button
            key={r.contextId}
            className={styles.row}
            onClick={() => enterRoom(r.contextId)}
            disabled={busy}
          >
            <span className={styles.roomAvatar}>{r.name.slice(0, 2).toUpperCase()}</span>
            <span className={styles.roomId}>{r.name}</span>
            <span className={styles.enter}>Enter →</span>
          </button>
        ))}
      </section>
    </div>
  );
}
