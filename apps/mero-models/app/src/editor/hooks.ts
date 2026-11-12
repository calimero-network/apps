import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { presenceState, type CalimeroClient, type PresenceEntry } from "@calimero-network/mero-js";
import { MeroModelsClient } from "../generated/client";
import { u64 } from "../meroModels";
import { useMaybeScene, useScene } from "../scene";
import { memberColor } from "./model";
import { GUEST, useEditor } from "./store";
import { BlobStore, clientTransport } from "./blobs";
import { SceneSync, messageOf } from "./sync";
import type { Peer } from "./viewport";
import { type ClientRoutes } from "@calimero-apps/connect";

/** How often to re-read the scene when no event arrived — one that landed while the stream reconnected. */
const POLL_MS = 8_000;

/** A device's presence entry lapses 7 s after its last refresh; refresh well inside that. */
const PRESENCE_HEARTBEAT_MS = 3_000;

/** Coalesce presence publishes (a camera drag) to at most one per this. */
const PRESENCE_THROTTLE_MS = 150;

const NAME_KEY = "mero-models:name";

export function storedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode: the name is only forgotten */
  }
}

/** The contract's client, bound to this session and scene. */
export function useModelsClient(contextId: string): MeroModelsClient | null {
  const scene = useMaybeScene();
  const client = scene?.client ?? null;
  const after = scene?.after;
  return useMemo(
    () => (client ? new MeroModelsClient(client, contextId, { after }) : null),
    [client, contextId, after],
  );
}

/**
 * Calls `onEvent` for each event of `app` written from now on, until the
 * returned stop. The stream starts at the instance's current log index (read
 * with a cheap view), so opening a scene does not replay its whole history.
 */
function subscribeEvents(
  client: Pick<CalimeroClient, "events"> & ClientRoutes<{ apps: "view" }>,
  app: string,
  onEvent: () => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    for (let attempt = 0; !abort.signal.aborted; attempt += 1) {
      try {
        const { index } = await client.apps.view({ app, method: "myRole", args: {} });
        for await (const _event of client.events(app, index, abort.signal)) onEvent();
      } catch {
        // Closed (sign-out, network): the poll covers the gap; retry a little later.
      }
      if (abort.signal.aborted) return;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))));
      onEvent();
    }
  })();
  return () => abort.abort();
}

/**
 * Keep the editor store in step with the scene: one `SceneSync` per open
 * scene, registered as the store's outbox, refreshed on every event of the
 * instance (an event is a nudge to re-read, never the data) and on a slow poll.
 */
export function useSceneSync(contextId: string): { sync: SceneSync | null; saving: boolean } {
  const scene = useScene();
  const client = useModelsClient(contextId);
  const [sync, setSync] = useState<SceneSync | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) return;
    const blobs = new BlobStore(clientTransport(scene.client, scene.after), contextId);
    const s = new SceneSync(client, blobs, (message) => useEditor.getState().notify(message, true), scene.name);
    useEditor.getState().setOutbox(s);
    setSync(s);
    void s.refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void s.refresh();
    }, POLL_MS);
    const saver = window.setInterval(() => setSaving(s.saving), 300);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(saver);
      s.dispose();
      useEditor.getState().setOutbox(null);
      // A different scene must not inherit this one's objects or history.
      useEditor.setState({
        objects: new Map(),
        meshes: new Map(),
        meshStatus: new Map(),
        textures: new Map(),
        locks: new Map(),
        selection: [],
        past: [],
        future: [],
        loaded: false,
        mode: "object",
        vertexSelection: new Set(),
      });
    };
  }, [client, scene.client, scene.after, scene.name, contextId]);

  const nudge = useRef<number | null>(null);
  useEffect(() => {
    if (!sync) return;
    const stop = subscribeEvents(scene.client, contextId, () => {
      // Several events arrive together for one call (and our own writes echo
      // back); one read covers them all.
      if (nudge.current !== null) window.clearTimeout(nudge.current);
      nudge.current = window.setTimeout(() => {
        nudge.current = null;
        void sync.refresh();
      }, 120);
    });
    return () => {
      stop();
      if (nudge.current !== null) window.clearTimeout(nudge.current);
    };
  }, [sync, scene.client, contextId]);

  return { sync, saving };
}

/** Tell the scene who this is. Re-sent when the name changes. */
export function useJoin(contextId: string, name: string): void {
  const client = useModelsClient(contextId);
  useEffect(() => {
    if (!client) return;
    const t = window.setTimeout(() => {
      void client.join({ name: name || GUEST, now: u64(Date.now()) }).catch((e) => {
        // Presence in the members list is a nicety; editing works without it.
        console.warn("[mero-models] join failed:", messageOf(e));
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [client, name]);
}

/** What each open editor streams over presence. Never stored. */
interface Slice {
  name: string;
  account: string;
  selection: string[];
  camera: [number, number, number] | null;
  target: [number, number, number] | null;
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** A peer's entry is whatever their client sent: parse it, or drop it. */
function parseSlice(state: string | null): Partial<Slice> | null {
  if (!state) return null;
  const bytes = fromHex(state);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" ? (value as Partial<Slice>) : null;
  } catch {
    return null;
  }
}

/** One presence entry at most 4 KiB: a selection is trimmed until it fits. */
function encodeSlice(slice: Slice): Uint8Array {
  const enc = new TextEncoder();
  let s = slice;
  let bytes = enc.encode(JSON.stringify(s));
  while (bytes.length > 4096 && s.selection.length > 0) {
    s = { ...s, selection: s.selection.slice(0, Math.floor(s.selection.length / 2)) };
    bytes = enc.encode(JSON.stringify(s));
  }
  return bytes;
}

/**
 * Who else is in the scene right now, what they have selected and where they
 * are looking from — over the instance's presence channel
 * (`/apps/{app}/presence`), so a camera move is not a call and nothing about
 * it is kept. Each device holds one entry (at most 4 KiB), refreshed by a
 * heartbeat; an entry not refreshed within 7 s is gone.
 */
export function usePresence(contextId: string, name: string): {
  peers: Peer[];
  publishCamera: (camera: [number, number, number], target: [number, number, number]) => void;
} {
  const scene = useScene();
  const me = useEditor((s) => s.me);
  const selection = useEditor((s) => s.selection);
  const [entries, setEntries] = useState<Map<string, Partial<Slice>>>(new Map());
  const slice = useRef<Slice>({ name, account: me, selection: [], camera: null, target: null });
  const publish = useRef<() => void>(() => {});

  // Publishing: a seq that only grows (across reloads too), a throttle, and a heartbeat.
  useEffect(() => {
    const client = scene.client;
    let seq = 0;
    let timer: number | null = null;
    let last = 0;
    const send = () => {
      timer = null;
      last = Date.now();
      seq = Math.max(seq + 1, Date.now() * 1000);
      void client.apps
        .presencePublish({ app: contextId, seq, state: presenceState(encodeSlice(slice.current)) })
        .catch(() => undefined);
    };
    publish.current = () => {
      if (timer !== null) return;
      timer = window.setTimeout(send, Math.max(0, PRESENCE_THROTTLE_MS - (Date.now() - last)));
    };
    const beat = window.setInterval(send, PRESENCE_HEARTBEAT_MS);
    send();
    return () => {
      window.clearInterval(beat);
      if (timer !== null) window.clearTimeout(timer);
      publish.current = () => {};
      seq = Math.max(seq + 1, Date.now() * 1000);
      void client.apps
        .presencePublish({ app: contextId, seq, state: presenceState(null) })
        .catch(() => undefined);
    };
  }, [scene.client, contextId]);

  useEffect(() => {
    slice.current = { ...slice.current, name: name || GUEST, account: me, selection };
    publish.current();
  }, [name, me, selection]);

  // Reading: the snapshot, then one event per change.
  useEffect(() => {
    const abort = new AbortController();
    const self = scene.accountId;
    void (async () => {
      try {
        for await (const event of scene.client.presenceStream(contextId, abort.signal)) {
          const list: PresenceEntry[] =
            event.kind === "snapshot" && Array.isArray(event.data)
              ? (event.data as PresenceEntry[])
              : event.kind === "presence" && event.data && typeof event.data === "object"
                ? [event.data as PresenceEntry]
                : [];
          if (list.length === 0 && event.kind !== "snapshot") continue;
          setEntries((prev) => {
            const next = event.kind === "snapshot" ? new Map<string, Partial<Slice>>() : new Map(prev);
            for (const entry of list) {
              if (entry.account === self) continue;
              const key = `${entry.account}:${entry.device}`;
              const parsed = parseSlice(entry.state);
              if (parsed) next.set(key, { ...parsed, account: entry.account });
              else next.delete(key);
            }
            return next;
          });
        }
      } catch {
        // Closed (sign-out, scene left, network): peers simply stop updating.
      }
    })();
    return () => abort.abort();
  }, [scene.client, scene.accountId, contextId]);

  const publishCamera = useCallback((camera: [number, number, number], target: [number, number, number]) => {
    slice.current = { ...slice.current, camera, target };
    publish.current();
  }, []);

  const peers = useMemo(
    () =>
      [...entries].map(([key, s]) => ({
        key,
        name: typeof s.name === "string" && s.name ? s.name : GUEST,
        color: memberColor(s.account || key),
        selection: Array.isArray(s.selection) ? s.selection.filter((x) => typeof x === "string").slice(0, 200) : [],
        camera: validTriple(s.camera),
        target: validTriple(s.target),
      })),
    [entries],
  );
  return { peers, publishCamera };
}

/** A peer's slice is whatever their client sent: take only a well-formed point. */
function validTriple(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (v as [number, number, number])
    : null;
}
